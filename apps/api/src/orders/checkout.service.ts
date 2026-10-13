import { EventEmitter2 } from '@nestjs/event-emitter';
import { EVENTS } from '../notifications/notification.events';
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { PaymentMethod, Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { CartContext, CartService } from '../cart/cart.service';
import { CommissionService } from '../commission/commission.service';
import { Rule } from '../commission/commission.rules';
import { CountryInfo } from '../common/country/country.service';
import { OrderLedgerService } from '../ledger/order-ledger.service';
import { PaymentsService } from '../payments/payments.service';
import { UnpaidOrdersService } from './unpaid-orders.service';
import { DeliverySlotsService } from '../delivery/slots.module';
import { classify, OrderTrafficDto, TrafficService } from '../analytics/traffic';
import { WarehousesService } from '../warehouses/warehouses';
import { CodGuardService } from '../cash/cod-rules';
import { ATTRIBUTION_DAYS } from '../marketing/cart-reminders';
import { PAYLATER_MAX_MINOR, PAYLATER_MIN_MINOR } from '../payments/providers/paylater.provider';
import { PricedLine } from '../pricing/pricing.types';
import { PrismaService } from '../prisma/prisma.service';
import { buildOrderNumber } from './order-status';
import { CheckoutDto } from './dto/order.dto';

@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cart: CartService,
    private readonly commissions: CommissionService,
    private readonly payments: PaymentsService,
    private readonly orderLedger: OrderLedgerService,
    private readonly unpaid: UnpaidOrdersService,
    private readonly audit: AuditService,
    @Optional() private readonly events?: EventEmitter2,
    @Optional() private readonly slots?: DeliverySlotsService,
    @Optional() private readonly traffic?: TrafficService,
    @Optional() private readonly warehouses?: WarehousesService,
    @Optional() private readonly cod?: CodGuardService,
  ) {}

  /**
   * Places the order. Everything that must be true at once — stock reservation, order rows,
   * coupon usage, campaign counters, cart clearing — happens in ONE database transaction.
   * The payment is started after it commits, so a gateway timeout can never leave phantom stock.
   *
   * Prices are recalculated here from the database; the client's numbers are never trusted.
   */
  async checkout(userId: string, country: CountryInfo, dto: CheckoutDto, idempotencyKey: string) {
    const existing = await this.existingFor(idempotencyKey, userId);
    if (existing) return this.result(existing, { reused: true }); // double tap / retry -> same order

    const address = await this.prisma.address.findFirst({ where: { id: dto.addressId, userId } });
    if (!address) throw new NotFoundException('Address not found');
    if (dto.whatsappOptIn) await this.optInWhatsApp(userId, address.phone);
    // "Buy now": that one item, in its own small cart (the customer's cart is left as it is); their coupon limits apply
    const cart: CartContext = dto.buyNowToken ? { country, guestToken: dto.buyNowToken, couponFor: userId } : { userId, country };
    return this.place({ userId, cart, country, address, dto, idempotencyKey });
  }

  /** Records WhatsApp consent. An account without a mobile number takes the delivery number, unless someone else has it. */
  private async optInWhatsApp(userId: string, deliveryPhone: string | null) {
    const me = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { phone: true } });
    let phone = me.phone;
    if (!phone && deliveryPhone) {
      const owner = await this.prisma.user.findUnique({ where: { phone: deliveryPhone }, select: { id: true } });
      if (!owner) phone = deliveryPhone;
    }
    if (!phone) return; // nowhere to send to: consent is not recorded
    await this.prisma.user.update({ where: { id: userId }, data: { phone, whatsappOptIn: true, whatsappOptInAt: new Date() } }).catch(() => undefined);
  }

  /**
   * The same key always gives the same order back — but only to the customer who placed it. Someone else presenting
   * a key they saw must not learn anything about that order.
   */
  async existingFor(idempotencyKey: string, userId: string): Promise<string | null> {
    const existing = await this.prisma.order.findUnique({ where: { idempotencyKey }, select: { id: true, userId: true } });
    if (!existing) return null;
    if (existing.userId !== userId) throw new ConflictException('This request was already used. Please try again.');
    return existing.id;
  }

  /** Places an order for `userId` from the cart described by `cart` (the user's cart, or a guest cart token). */
  async place(p: {
    userId: string;
    cart: CartContext;
    country: CountryInfo;
    address: Record<string, unknown> & { countryCode: string };
    dto: { paymentMethod: PaymentMethod; note?: string; returnUrl?: string; deliverySlot?: string; traffic?: OrderTrafficDto };
    idempotencyKey: string;
    /** a phone order: the staff member spoke to the customer, so the "verified mobile" rule for cash does not apply */
    phoneConfirmedByStaff?: boolean;
  }) {
    const { userId, country, address, dto, idempotencyKey } = p;
    const ctx = p.cart;
    const { cart, lines, priced, canCheckout } = await this.cart.priceForCheckout(ctx);
    if (!priced.groups.length) throw new BadRequestException('Your cart is empty');
    if (!canCheckout) {
      const view = await this.cart.view(ctx);
      throw new ConflictException({ message: 'Your cart needs attention before checkout', notices: view.notices, cart: view });
    }

    if (address.countryCode !== country.code) throw new BadRequestException('This address is in a different country');

    const enabled = await this.prisma.country.findUniqueOrThrow({ where: { code: country.code }, select: { paymentMethods: true } });
    if (!enabled.paymentMethods.includes(dto.paymentMethod)) throw new BadRequestException(`${dto.paymentMethod} is not available in ${country.code}`);
    if (!this.payments.isAvailable(dto.paymentMethod)) throw new BadRequestException(`${dto.paymentMethod} is not available right now. Please choose another payment method.`);
    this.payments.assertReturnUrl(dto.paymentMethod, dto.returnUrl);
    if (dto.paymentMethod === 'PAYLATER' && (priced.totalMinor < PAYLATER_MIN_MINOR || priced.totalMinor > PAYLATER_MAX_MINOR)) {
      throw new BadRequestException({ message: 'Pay in instalments is available for orders from QAR 300 to QAR 25,000.', reason: 'PAYLATER_AMOUNT' });
    }
    if (dto.paymentMethod === 'COD' && this.cod) {
      // fake cash orders cost a driver trip and hold stock: blocked customers, order size, open orders, verified phone
      const who = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { isGuest: true } });
      await this.cod.assertAllowed({
        userId, countryCode: country.code, currencyCode: country.currencyCode, totalMinor: priced.totalMinor,
        phone: typeof address.phone === 'string' ? address.phone : null, isGuest: who.isGuest, phoneConfirmed: !!p.phoneConfirmedByStaff,
      });
    }

    const rules = await this.commissions.loadRules(country.code);
    const meta = new Map(lines.map((l) => [l.row.id, l]));
    const now = new Date();
    const orderNumber = buildOrderNumber(country.code, now, randomBytes(3).toString('hex'));
    // Was this customer reminded about this cart recently? Then the reminder gets credit for the order.
    const reminded = await this.prisma.cart.findUnique({ where: { id: cart.id }, select: { lastReminderAt: true } });
    const cartReminderAt = reminded?.lastReminderAt && reminded.lastReminderAt.getTime() >= now.getTime() - ATTRIBUTION_DAYS * 86_400_000 ? reminded.lastReminderAt : null;
    // where the visit came from (same rules as the analytics sessions); nothing sent = an app or unknown
    const traffic = dto.traffic ? classify(dto.traffic) : null;

    const orderId = await this.prisma.$transaction(async (tx) => {
      // Takes a place in the chosen delivery window (rolled back with everything else if the order fails)
      const slot = this.slots ? await this.slots.book(tx, country.code, dto.deliverySlot, now) : null;
      const order = await tx.order.create({
        data: {
          orderNumber, userId, countryCode: country.code, currencyCode: country.currencyCode, status: 'PENDING',
          subtotalMinor: priced.subtotalMinor, discountMinor: priced.discountMinor, deliveryFeeMinor: priced.deliveryFeeMinor,
          taxMinor: priced.taxMinor, totalMinor: priced.totalMinor,
          couponId: priced.coupon?.applied ? priced.coupon.id : null,
          shippingAddress: this.snapshotAddress(address),
          idempotencyKey, customerNote: dto.note,
          deliverySlotStart: slot?.start ?? null, deliverySlotEnd: slot?.end ?? null, cartReminderAt,
          trafficSource: traffic?.source ?? null, trafficMedium: traffic?.medium ?? null, trafficCampaign: traffic?.campaign ?? null,
        },
        select: { id: true },
      });

      for (const group of priced.groups) {
        // which of the seller's warehouses packs it: the one that has everything, nearest to the delivery zone
        const need = group.lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity }));
        const warehouseId = this.warehouses ? await this.warehouses.choose(tx, group.sellerId, need, typeof address.zone === 'string' ? address.zone : null) : null;
        const sellerOrder = await tx.sellerOrder.create({
          data: {
            orderId: order.id, sellerId: group.sellerId, status: 'PENDING', deliveryMethod: 'SELLER', warehouseId,
            subtotalMinor: group.subtotalMinor, discountMinor: group.discountMinor, deliveryFeeMinor: group.deliveryFeeMinor,
            taxMinor: group.taxMinor, commissionMinor: 0n, sellerNetMinor: 0n,
          },
          select: { id: true },
        });

        let commissionTotal = 0n;
        const discountFundedBy = priced.coupon?.applied ? (priced.coupon.fundedBy as 'PLATFORM' | 'SELLER') : null;
        for (const line of group.lines) {
          await this.reserveStock(tx, line, meta.get(line.itemId)!.row.variant.product.title);
          const commission = this.commissionFor(rules, line, country.code, meta, now, discountFundedBy);
          commissionTotal += commission.commissionMinor;
          const m = meta.get(line.itemId)!;
          await tx.orderItem.create({
            data: {
              orderId: order.id, sellerOrderId: sellerOrder.id, variantId: line.variantId,
              productTitle: m.row.variant.product.title, sku: m.row.variant.sku,
              imageKey: m.row.variant.product.images[0]?.fileKey ?? null,
              unitPriceMinor: line.unitPriceMinor, quantity: line.quantity, discountMinor: line.discountMinor,
              taxMinor: line.taxMinor, lineTotalMinor: line.lineTotalMinor,
              commissionMinor: commission.commissionMinor, commissionRuleId: commission.ruleId, campaignId: line.campaignId,
              commissionSnapshot: { ...commission.snapshot, discountFundedBy } as Prisma.InputJsonValue, status: 'PENDING',
            },
          });
          if (line.campaignId) await this.countCampaignSale(tx, line);
        }

        // Seller earns goods (after discount) + delivery fee, minus FastMoveX commission
        const sellerNet = group.subtotalMinor - group.discountMinor + group.deliveryFeeMinor - commissionTotal;
        await tx.sellerOrder.update({ where: { id: sellerOrder.id }, data: { commissionMinor: commissionTotal, sellerNetMinor: sellerNet } });
      }

      if (priced.coupon?.applied) await this.redeemCoupon(tx, priced.coupon.id, userId, order.id, priced.coupon.discountMinor);

      await tx.payment.create({
        data: {
          orderId: order.id, provider: this.payments.providerFor(dto.paymentMethod).code, method: dto.paymentMethod,
          status: 'PENDING', amountMinor: priced.totalMinor, currencyCode: country.currencyCode,
          idempotencyKey: `pay_${idempotencyKey}`,
        },
      });

      await tx.orderStatusHistory.create({ data: { orderId: order.id, toStatus: 'PENDING', actorId: userId, note: 'Order placed' } });
      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
      await tx.cart.update({ where: { id: cart.id }, data: { couponCode: null } });
      return order.id;
    });

    await this.audit.log({ actorId: userId, action: 'order.placed', entityType: 'Order', entityId: orderId, after: { orderNumber, totalMinor: priced.totalMinor.toString(), method: dto.paymentMethod } });

    const payment = await this.prisma.payment.findFirstOrThrow({ where: { orderId }, select: { id: true } });
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, phone: true } });
    const result = await this.payments.start(payment.id, dto.paymentMethod, {
      orderId, orderNumber, amountMinor: priced.totalMinor, currencyCode: country.currencyCode, method: dto.paymentMethod,
      customer: { id: userId, email: user.email, phone: user.phone }, idempotencyKey: `pay_${idempotencyKey}`, returnUrl: dto.returnUrl,
    });

    // COD and captured card payments confirm immediately; redirect flows wait for the webhook.
    if (result.status === 'CAPTURED' || result.status === 'AUTHORIZED' || dto.paymentMethod === 'COD') {
      await this.confirm(orderId, userId);
    }
    // Money actually received -> write the double-entry ledger. COD posts on delivery instead.
    if (result.status === 'CAPTURED') await this.orderLedger.postCapture(orderId);
    this.events?.emit(EVENTS.ORDER_PLACED, { orderId });
    this.traffic?.purchased(country.code, dto.traffic?.sessionId);
    if (result.status === 'CAPTURED' || result.status === 'AUTHORIZED' || dto.paymentMethod === 'COD') this.events?.emit(EVENTS.ORDER_CONFIRMED, { orderId });
    if (result.status === 'FAILED') this.events?.emit(EVENTS.PAYMENT_FAILED, { orderId });
    if (result.status === 'FAILED') {
      // give the stock, deal quota and coupon back, and put the items back in the cart for a retry
      await this.unpaid.abandon(orderId, `Payment failed: ${result.failureReason ?? 'unknown'}`);
    }

    return this.result(orderId, { payment: { status: result.status, redirectUrl: result.redirectUrl ?? null, failureReason: result.failureReason ?? null } });
  }

  private async confirm(orderId: string, userId: string) {
    await this.prisma.$transaction([
      this.prisma.order.update({ where: { id: orderId }, data: { status: 'CONFIRMED' } }),
      this.prisma.sellerOrder.updateMany({ where: { orderId, status: 'PENDING' }, data: { status: 'CONFIRMED' } }),
      this.prisma.orderItem.updateMany({ where: { orderId, status: 'PENDING' }, data: { status: 'CONFIRMED' } }),
      this.prisma.orderStatusHistory.create({ data: { orderId, fromStatus: 'PENDING', toStatus: 'CONFIRMED', actorId: userId, note: 'Payment accepted' } }),
    ]);
  }

  /** Conditional update: the row is only reserved if the units are still free right now. */
  private async reserveStock(tx: Prisma.TransactionClient, line: PricedLine, title: string) {
    const reserved = await tx.$executeRaw`
      UPDATE "Inventory" SET "reserved" = "reserved" + ${line.quantity}, "version" = "version" + 1, "updatedAt" = now()
      WHERE "variantId" = ${line.variantId}::uuid AND "onHand" - "reserved" >= ${line.quantity}`;
    if (reserved !== 1) throw new ConflictException({ message: `"${title}" just sold out. Please update your cart.`, variantId: line.variantId });
    await tx.inventoryMovement.create({ data: { variantId: line.variantId, qtyDelta: 0, reason: 'RESERVE', refType: 'order_item', refId: line.itemId, note: `Reserved ${line.quantity}` } });
  }

  private async countCampaignSale(tx: Prisma.TransactionClient, line: PricedLine) {
    const updated = await tx.$executeRaw`
      UPDATE "CampaignProduct" SET "soldCount" = "soldCount" + ${line.quantity}
      WHERE "campaignId" = ${line.campaignId}::uuid AND "variantId" = ${line.variantId}::uuid
        AND ("stockLimit" IS NULL OR "soldCount" + ${line.quantity} <= "stockLimit")`;
    if (updated !== 1) throw new ConflictException('This deal just ended. Please refresh your cart.');
  }

  /** Usage limit is enforced in the same transaction, so a coupon cannot go over its cap under load. */
  private async redeemCoupon(tx: Prisma.TransactionClient, couponId: string, userId: string, orderId: string, discountMinor: bigint) {
    const used = await tx.$executeRaw`
      UPDATE "Coupon" SET "usedCount" = "usedCount" + 1
      WHERE "id" = ${couponId}::uuid AND ("usageLimit" IS NULL OR "usedCount" < "usageLimit")`;
    if (used !== 1) throw new ConflictException('This promo code has just reached its limit');
    await tx.couponRedemption.create({ data: { couponId, userId, orderId, discountMinor } });
  }

  /**
   * Commission is charged on what the SELLER earns for the goods:
   *  - seller-funded discount -> base is the discounted amount (the seller chose to give it)
   *  - FastMoveX-funded discount  -> base is the full price (FastMoveX pays the discount and reimburses the seller,
   *    so the seller still receives price minus commission, exactly as without the coupon)
   */
  private commissionFor(
    rules: Rule[], line: PricedLine, countryCode: string, meta: Map<string, { row: { variant: { product: { category: { path: string } } } } }>, now: Date,
    discountFundedBy: 'PLATFORM' | 'SELLER' | null,
  ) {
    return this.commissions.compute(rules, {
      countryCode, categoryPath: meta.get(line.itemId)!.row.variant.product.category.path, sellerId: line.sellerId,
      productId: line.productId, campaignId: line.campaignId, quantity: line.quantity,
      netAmountMinor: discountFundedBy === 'PLATFORM' ? line.lineSubtotalMinor : line.lineSubtotalMinor - line.discountMinor,
    }, now);
  }

  private snapshotAddress(a: Record<string, unknown>): Prisma.InputJsonValue {
    const { id, userId, createdAt, updatedAt, isDefault, label, ...rest } = a;
    return { ...rest, ...(id ? { addressId: id } : {}), ...(label ? { label } : {}) } as Prisma.InputJsonValue;
  }

  async result(orderId: string, extra: Record<string, unknown>) {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { id: true, orderNumber: true, status: true, totalMinor: true, currencyCode: true, placedAt: true },
    });
    return { ...order, totalMinor: order.totalMinor.toString(), ...extra };
  }
}
