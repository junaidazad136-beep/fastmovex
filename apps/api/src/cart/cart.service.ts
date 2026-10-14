import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { CountryInfo } from '../common/country/country.service';
import { PrismaService } from '../prisma/prisma.service';
import { COUPON_MESSAGES, CouponError, CouponService, normalizeCode } from '../pricing/coupon.service';
import { ConfigDeliveryQuoter } from '../pricing/delivery-quoter';
import { priceCart } from '../pricing/pricing.engine';
import { CouponRule, LineIssue, PricedCart, PricingLine } from '../pricing/pricing.types';
import { StorageService } from '../storage/storage.service';
import { MAX_CART_LINES, MAX_QTY_PER_LINE } from './dto/cart.dto';
import { isAway } from '../stores/away';

export interface CartContext {
  country: CountryInfo;
  userId?: string;
  guestToken?: string;
  /**
   * Whose promo-code limits apply to a cart without a signed-in owner (staff phone orders): an existing customer,
   * or 'NEW' for a caller who gets a new profile when the order is placed.
   */
  couponFor?: string | 'NEW';
}

/** The customer whose promo-code limits apply. */
function couponUser(ctx: CartContext): { userId?: string; newCustomer: boolean } {
  if (ctx.userId) return { userId: ctx.userId, newCustomer: false };
  if (ctx.couponFor === 'NEW') return { newCustomer: true };
  return { userId: ctx.couponFor, newCustomer: false };
}

/** The line's options in Arabic ({"اللون": "أسود"}) from the product's option words; words without Arabic stay as they are. */
export function arabicOptions(options: unknown, dict: unknown): Record<string, string> | null {
  const d = (dict ?? {}) as Record<string, string>;
  const o = (options ?? {}) as Record<string, string>;
  if (!Object.keys(d).length || !Object.keys(o).length) return null;
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [d[k] ?? k, d[String(v)] ?? String(v)]));
}

const BLOCKING: LineIssue[] = ['UNAVAILABLE', 'STORE_AWAY', 'OUT_OF_STOCK', 'INSUFFICIENT_STOCK', 'WRONG_COUNTRY'];

const ITEM_SELECT = {
  id: true, quantity: true, priceSnapshotMinor: true, addedAt: true,
  variant: {
    select: {
      id: true, sku: true, optionValues: true, priceMinor: true, compareAtMinor: true, isActive: true,
      inventory: { select: { onHand: true, reserved: true } },
      campaignProducts: {
        select: { campaignId: true, dealPriceMinor: true, stockLimit: true, soldCount: true, campaign: { select: { isActive: true, startsAt: true, endsAt: true, countryCode: true } } },
      },
      product: {
        select: {
          id: true, slug: true, title: true, titleAr: true, optionsAr: true, status: true, deletedAt: true, countryCode: true,
          category: { select: { path: true } },
          images: { select: { fileKey: true }, orderBy: { sortOrder: 'asc' as const }, take: 1 },
          store: { select: { name: true, nameAr: true, slug: true, isActive: true, awayUntil: true, sellerId: true, seller: { select: { status: true } } } },
        },
      },
    },
  },
} satisfies Prisma.CartItemSelect;

type ItemRow = Prisma.CartItemGetPayload<{ select: typeof ITEM_SELECT }>;

/** Best live deal for a variant in this market, or the normal price. Exported for tests. */
export function effectiveUnitPrice(row: Pick<ItemRow['variant'], 'priceMinor' | 'campaignProducts'>, countryCode: string, now: Date): { unit: bigint; campaignId: string | null } {
  let unit = row.priceMinor;
  let campaignId: string | null = null;
  for (const cp of row.campaignProducts) {
    const c = cp.campaign;
    const live = c.isActive && c.countryCode === countryCode && c.startsAt <= now && c.endsAt > now && (cp.stockLimit === null || cp.soldCount < cp.stockLimit);
    if (live && cp.dealPriceMinor < unit) { unit = cp.dealPriceMinor; campaignId = cp.campaignId; }
  }
  return { unit, campaignId };
}

export function lineIssues(row: ItemRow, countryCode: string, unit: bigint): { issues: LineIssue[]; available: number } {
  const v = row.variant;
  const p = v.product;
  const issues: LineIssue[] = [];
  const visible = v.isActive && p.status === 'ACTIVE' && !p.deletedAt && p.store.isActive && p.store.seller.status === 'APPROVED';
  const available = Math.max(0, (v.inventory?.onHand ?? 0) - (v.inventory?.reserved ?? 0));
  if (!visible) issues.push('UNAVAILABLE');
  else if (isAway(p.store.awayUntil)) issues.push('STORE_AWAY');
  else if (p.countryCode !== countryCode) issues.push('WRONG_COUNTRY');
  else if (available === 0) issues.push('OUT_OF_STOCK');
  else if (row.quantity > available) issues.push('INSUFFICIENT_STOCK');
  if (unit !== row.priceSnapshotMinor) issues.push('PRICE_CHANGED');
  return { issues, available };
}

const s = (v: bigint) => v.toString();

@Injectable()
export class CartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly coupons: CouponService,
    private readonly delivery: ConfigDeliveryQuoter,
    private readonly storage: StorageService,
  ) {}

  // -------------------------------------------------------------- identity

  private async findCart(ctx: CartContext) {
    if (ctx.userId) return this.prisma.cart.findUnique({ where: { userId_countryCode: { userId: ctx.userId, countryCode: ctx.country.code } } });
    if (!ctx.guestToken) return null;
    const cart = await this.prisma.cart.findUnique({ where: { guestToken: ctx.guestToken } });
    // A guest token can never open a user's cart or a cart from another market
    return cart && !cart.userId && cart.countryCode === ctx.country.code ? cart : null;
  }

  private async findOrCreateCart(ctx: CartContext) {
    const found = await this.findCart(ctx);
    if (found) return found;
    if (ctx.userId) {
      return this.prisma.cart.upsert({
        where: { userId_countryCode: { userId: ctx.userId, countryCode: ctx.country.code } },
        update: {},
        create: { userId: ctx.userId, countryCode: ctx.country.code, currencyCode: ctx.country.currencyCode },
      });
    }
    return this.prisma.cart.create({
      data: { guestToken: randomBytes(24).toString('base64url'), countryCode: ctx.country.code, currencyCode: ctx.country.currencyCode },
    });
  }

  // --------------------------------------------------------------- reading

  async view(ctx: CartContext) {
    const cart = await this.findCart(ctx);
    if (!cart) return this.emptyView(ctx);
    return this.render(cart, ctx);
  }

  /**
   * Full server-side pricing of a cart. Checkout calls this too, so what the customer sees
   * is exactly what gets charged. Exposed for the checkout module.
   */
  async priceForCheckout(ctx: CartContext) {
    const cart = await this.findCart(ctx);
    if (!cart) throw new BadRequestException('Your cart is empty');
    return this.compute(cart, ctx);
  }

  private async compute(cart: { id: string; couponCode: string | null }, ctx: CartContext) {
    const now = new Date();
    const rows = await this.prisma.cartItem.findMany({ where: { cartId: cart.id }, orderBy: { addedAt: 'asc' }, select: ITEM_SELECT });

    const lines = rows.map((row) => {
      const { unit, campaignId } = effectiveUnitPrice(row.variant, ctx.country.code, now);
      const { issues, available } = lineIssues(row, ctx.country.code, unit);
      return { row, unit, campaignId, issues, available };
    });
    const priceable = lines.filter((l) => !l.issues.some((i) => BLOCKING.includes(i)));
    const pricingLines: PricingLine[] = priceable.map((l) => ({
      itemId: l.row.id, variantId: l.row.variant.id, productId: l.row.variant.product.id, sellerId: l.row.variant.product.store.sellerId,
      categoryPath: l.row.variant.product.category.path, quantity: l.row.quantity,
      unitListMinor: l.row.variant.priceMinor, unitPriceMinor: l.unit, campaignId: l.campaignId,
    }));

    let rule: CouponRule | null = null;
    let couponError: CouponError | null = null;
    if (cart.couponCode) {
      const who = couponUser(ctx);
      const r = await this.coupons.resolve(cart.couponCode, ctx.country.code, who.userId, now, who.newCustomer);
      if ('error' in r) couponError = r.error;
      else rule = r.rule;
    }

    const priced = priceCart({
      lines: pricingLines,
      coupon: rule,
      tax: { rateBps: ctx.country.vatRateBps, inclusive: ctx.country.pricesIncludeTax },
      quoteDelivery: this.delivery.forCountry(ctx.country.deliveryConfig),
    });

    const hasBlocking = lines.some((l) => l.issues.some((i) => BLOCKING.includes(i)));
    const hasPriceChange = lines.some((l) => l.issues.includes('PRICE_CHANGED'));
    return { cart, lines, priced, couponError, canCheckout: priceable.length > 0 && !hasBlocking && !hasPriceChange, hasBlocking, hasPriceChange };
  }

  private async render(cart: { id: string; guestToken: string | null; couponCode: string | null; currencyCode: string }, ctx: CartContext) {
    const { lines, priced, couponError, canCheckout, hasBlocking, hasPriceChange } = await this.compute(cart, ctx);
    const pricedById = new Map(priced.groups.flatMap((g) => g.lines).map((l) => [l.itemId, l]));
    const groupBySeller = new Map(priced.groups.map((g) => [g.sellerId, g]));

    const sellerOrder: string[] = [];
    const bySeller = new Map<string, typeof lines>();
    for (const l of lines) {
      const sid = l.row.variant.product.store.sellerId;
      if (!bySeller.has(sid)) { bySeller.set(sid, []); sellerOrder.push(sid); }
      bySeller.get(sid)!.push(l);
    }

    const groups = sellerOrder.map((sid) => {
      const items = bySeller.get(sid)!;
      const store = items[0].row.variant.product.store;
      const g = groupBySeller.get(sid);
      return {
        store: { slug: store.slug, name: store.name, nameAr: store.nameAr, awayUntil: isAway(store.awayUntil) ? store.awayUntil : null },
        items: items.map((l) => {
          const p = l.row.variant.product;
          const pl = pricedById.get(l.row.id);
          return {
            id: l.row.id,
            variantId: l.row.variant.id,
            productSlug: p.slug,
            title: p.title,
            titleAr: p.titleAr,
            imageUrl: this.storage.publicUrl(p.images[0]?.fileKey),
            sku: l.row.variant.sku,
            options: l.row.variant.optionValues,
            optionsAr: arabicOptions(l.row.variant.optionValues, p.optionsAr),
            quantity: l.row.quantity,
            available: l.available,
            maxQuantity: Math.min(MAX_QTY_PER_LINE, l.available),
            unitPriceMinor: s(l.unit),
            listPriceMinor: s(l.row.variant.priceMinor),
            compareAtMinor: l.row.variant.compareAtMinor ? s(l.row.variant.compareAtMinor) : null,
            onDeal: l.campaignId !== null,
            lineSubtotalMinor: pl ? s(pl.lineSubtotalMinor) : '0',
            discountMinor: pl ? s(pl.discountMinor) : '0',
            priceChangedFromMinor: l.issues.includes('PRICE_CHANGED') ? s(l.row.priceSnapshotMinor) : null,
            issues: l.issues,
          };
        }),
        subtotalMinor: s(g?.subtotalMinor ?? 0n),
        discountMinor: s(g?.discountMinor ?? 0n),
        deliveryFeeMinor: s(g?.deliveryFeeMinor ?? 0n),
        deliveryWaived: g?.deliveryWaived ?? false,
        deliveryLabel: g?.delivery.label ?? null,
        taxMinor: s(g?.taxMinor ?? 0n),
        totalMinor: s(g?.totalMinor ?? 0n),
      };
    });

    return {
      cartToken: ctx.userId ? null : cart.guestToken,
      currencyCode: cart.currencyCode,
      groups,
      coupon: this.couponView(cart.couponCode, priced.coupon, couponError),
      totals: {
        itemCount: lines.reduce((n, l) => n + l.row.quantity, 0),
        subtotalMinor: s(priced.subtotalMinor),
        discountMinor: s(priced.discountMinor),
        deliveryFeeMinor: s(priced.deliveryFeeMinor),
        taxMinor: s(priced.taxMinor),
        taxIncluded: ctx.country.pricesIncludeTax,
        totalMinor: s(priced.totalMinor),
      },
      canCheckout,
      notices: [
        ...(hasBlocking ? ['Some items are unavailable or low in stock. Update them to continue.'] : []),
        ...(hasPriceChange ? ['Some prices changed since you added them. Review and confirm to continue.'] : []),
      ],
    };
  }

  /** `reason` is a stable code the apps translate; `message` is the English fallback. */
  private couponView(code: string | null, c: PricedCart['coupon'], error: CouponError | null) {
    if (!code) return null;
    if (error) return { code, applied: false, message: COUPON_MESSAGES[error], reason: error };
    if (!c) return { code, applied: false, message: COUPON_MESSAGES.NO_ELIGIBLE_ITEMS, reason: 'NO_ELIGIBLE_ITEMS' };
    if (!c.applied) {
      const message = c.reason === 'MIN_ORDER' ? COUPON_MESSAGES.MIN_ORDER : COUPON_MESSAGES.NO_ELIGIBLE_ITEMS;
      return { code, applied: false, message, reason: c.reason ?? 'NO_ELIGIBLE_ITEMS', shortByMinor: c.shortByMinor ? s(c.shortByMinor) : null };
    }
    return { code, applied: true, discountMinor: s(c.discountMinor), freeDelivery: c.freeDelivery };
  }

  private emptyView(ctx: CartContext) {
    const z = '0';
    return {
      cartToken: null, currencyCode: ctx.country.currencyCode, groups: [], coupon: null,
      totals: { itemCount: 0, subtotalMinor: z, discountMinor: z, deliveryFeeMinor: z, taxMinor: z, taxIncluded: ctx.country.pricesIncludeTax, totalMinor: z },
      canCheckout: false, notices: [],
    };
  }

  // --------------------------------------------------------------- writing

  /**
   * "Buy now": a small cart of its own holding just this item, so checkout can buy it without touching the customer's
   * cart. Returns its token (the website keeps it only for this checkout).
   */
  async buyNow(country: CountryInfo, variantId: string, quantity: number): Promise<{ cartToken: string }> {
    const view = await this.addItem({ country }, variantId, quantity);
    if (!view.cartToken) throw new BadRequestException('Could not start the checkout');
    return { cartToken: view.cartToken };
  }

  async addItem(ctx: CartContext, variantId: string, quantity: number) {
    const now = new Date();
    const v = await this.prisma.productVariant.findUnique({
      where: { id: variantId },
      select: {
        id: true, isActive: true, priceMinor: true, sku: true, optionValues: true, compareAtMinor: true,
        inventory: { select: { onHand: true, reserved: true } },
        campaignProducts: ITEM_SELECT.variant.select.campaignProducts,
        product: { select: { status: true, deletedAt: true, countryCode: true, store: { select: { isActive: true, awayUntil: true, seller: { select: { status: true } } } } } },
      },
    });
    const visible = v && v.isActive && v.product.status === 'ACTIVE' && !v.product.deletedAt && v.product.store.isActive && v.product.store.seller.status === 'APPROVED';
    if (!v || !visible) throw new NotFoundException('This product is no longer available');
    if (v.product.countryCode !== ctx.country.code) throw new BadRequestException('This product is not sold in your country');
    if (isAway(v.product.store.awayUntil, now)) throw new BadRequestException({ message: 'This store is on holiday and not taking orders right now', reason: 'STORE_AWAY' });

    const available = Math.max(0, (v.inventory?.onHand ?? 0) - (v.inventory?.reserved ?? 0));
    if (available === 0) throw new ConflictException({ message: 'Out of stock', available: 0 });

    const cart = await this.findOrCreateCart(ctx);
    const existing = await this.prisma.cartItem.findUnique({ where: { cartId_variantId: { cartId: cart.id, variantId } }, select: { quantity: true } });
    if (!existing) {
      const lines = await this.prisma.cartItem.count({ where: { cartId: cart.id } });
      if (lines >= MAX_CART_LINES) throw new BadRequestException(`Your cart can hold up to ${MAX_CART_LINES} different items`);
    }
    const newQty = (existing?.quantity ?? 0) + quantity;
    const limit = Math.min(MAX_QTY_PER_LINE, available);
    if (newQty > limit) throw new ConflictException({ message: `Only ${limit} can be added`, available: limit, inCart: existing?.quantity ?? 0 });

    const { unit } = effectiveUnitPrice(v, ctx.country.code, now);
    await this.prisma.cartItem.upsert({
      where: { cartId_variantId: { cartId: cart.id, variantId } },
      update: { quantity: newQty, priceSnapshotMinor: unit },
      create: { cartId: cart.id, variantId, quantity, priceSnapshotMinor: unit },
    });
    await this.touch(cart.id);
    return this.render(cart, ctx);
  }

  async updateItem(ctx: CartContext, itemId: string, quantity: number) {
    const cart = await this.mustFind(ctx);
    const item = await this.prisma.cartItem.findFirst({
      where: { id: itemId, cartId: cart.id }, // item must be in THIS caller's cart
      select: { id: true, quantity: true, variant: { select: { inventory: { select: { onHand: true, reserved: true } } } } },
    });
    if (!item) throw new NotFoundException('Item not found in your cart');
    if (quantity === 0) {
      await this.prisma.cartItem.delete({ where: { id: item.id } });
    } else {
      const available = Math.max(0, (item.variant.inventory?.onHand ?? 0) - (item.variant.inventory?.reserved ?? 0));
      if (quantity > item.quantity && quantity > Math.min(MAX_QTY_PER_LINE, available)) {
        throw new ConflictException({ message: `Only ${Math.min(MAX_QTY_PER_LINE, available)} available`, available });
      }
      await this.prisma.cartItem.update({ where: { id: item.id }, data: { quantity } });
    }
    await this.touch(cart.id);
    return this.render(cart, ctx);
  }

  async removeItem(ctx: CartContext, itemId: string) {
    return this.updateItem(ctx, itemId, 0);
  }

  async clear(ctx: CartContext) {
    const cart = await this.findCart(ctx);
    if (cart) await this.prisma.$transaction([this.prisma.cartItem.deleteMany({ where: { cartId: cart.id } }), this.prisma.cart.update({ where: { id: cart.id }, data: { couponCode: null } })]);
    return this.view(ctx);
  }

  async applyCoupon(ctx: CartContext, code: string) {
    const who = couponUser(ctx);
    if (!who.userId && !who.newCustomer) throw new BadRequestException(COUPON_MESSAGES.LOGIN_REQUIRED);
    const cart = await this.mustFind(ctx);
    const r = await this.coupons.resolve(code, ctx.country.code, who.userId, undefined, who.newCustomer);
    if ('error' in r) throw new BadRequestException({ message: COUPON_MESSAGES[r.error], reason: r.error });
    // Saved even if the cart does not qualify yet (e.g. min order) — the cart shows what is missing.
    await this.prisma.cart.update({ where: { id: cart.id }, data: { couponCode: normalizeCode(code) } });
    return this.render({ ...cart, couponCode: normalizeCode(code) }, ctx);
  }

  async removeCoupon(ctx: CartContext) {
    const cart = await this.mustFind(ctx);
    await this.prisma.cart.update({ where: { id: cart.id }, data: { couponCode: null } });
    return this.render({ ...cart, couponCode: null }, ctx);
  }

  /** Customer confirms they have seen the new prices. Required before checkout. */
  async acknowledgePrices(ctx: CartContext) {
    const cart = await this.mustFind(ctx);
    const { lines } = await this.compute(cart, ctx);
    const changed = lines.filter((l) => l.issues.includes('PRICE_CHANGED'));
    if (changed.length) {
      await this.prisma.$transaction(changed.map((l) => this.prisma.cartItem.update({ where: { id: l.row.id }, data: { priceSnapshotMinor: l.unit } })));
    }
    return this.render(cart, ctx);
  }

  /**
   * "Buy again": puts the items of an earlier order back in the cart — each at most what is in stock now, at today's
   * price. Items no longer sold (or sold out) are listed as skipped, never an error for the whole request.
   */
  async addLines(ctx: CartContext, items: { variantId: string; quantity: number; title: string }[]) {
    const added: { variantId: string; title: string; quantity: number }[] = [];
    const skipped: { variantId: string; title: string; reason: 'UNAVAILABLE' | 'OUT_OF_STOCK' | 'CART_FULL' }[] = [];
    const existing = await this.findCart(ctx);
    for (const it of items) {
      const [inv, inCart] = await Promise.all([
        this.prisma.inventory.findUnique({ where: { variantId: it.variantId }, select: { onHand: true, reserved: true } }),
        existing ? this.prisma.cartItem.findUnique({ where: { cartId_variantId: { cartId: existing.id, variantId: it.variantId } }, select: { quantity: true } }) : null,
      ]);
      const room = Math.min(MAX_QTY_PER_LINE, Math.max(0, (inv?.onHand ?? 0) - (inv?.reserved ?? 0))) - (inCart?.quantity ?? 0);
      const want = Math.min(it.quantity, room);
      if (want <= 0) {
        if (!inCart) skipped.push({ variantId: it.variantId, title: it.title, reason: 'OUT_OF_STOCK' });
        continue; // already in the cart, as many as there are
      }
      try {
        await this.addItem(ctx, it.variantId, want);
        added.push({ variantId: it.variantId, title: it.title, quantity: want });
      } catch (e) {
        const full = e instanceof BadRequestException && /can hold up to/.test(e.message);
        skipped.push({ variantId: it.variantId, title: it.title, reason: full ? 'CART_FULL' : e instanceof ConflictException ? 'OUT_OF_STOCK' : 'UNAVAILABLE' });
      }
    }
    return { cart: await this.view(ctx), added, skipped };
  }

  /** After login: move the guest cart into the user's cart (quantities added, capped). Guest cart is deleted. */
  async merge(userId: string, guestToken: string, country: CountryInfo) {
    const guest = await this.prisma.cart.findUnique({ where: { guestToken }, include: { items: true } });
    const userCtx: CartContext = { userId, country };
    if (!guest || guest.userId || guest.countryCode !== country.code) return this.view(userCtx);

    const target = await this.findOrCreateCart(userCtx);
    await this.prisma.$transaction(async (tx) => {
      for (const it of guest.items) {
        const cur = await tx.cartItem.findUnique({ where: { cartId_variantId: { cartId: target.id, variantId: it.variantId } }, select: { quantity: true } });
        const quantity = Math.min(MAX_QTY_PER_LINE, (cur?.quantity ?? 0) + it.quantity); // stock is re-checked when the cart is shown
        await tx.cartItem.upsert({
          where: { cartId_variantId: { cartId: target.id, variantId: it.variantId } },
          update: { quantity },
          create: { cartId: target.id, variantId: it.variantId, quantity, priceSnapshotMinor: it.priceSnapshotMinor },
        });
      }
      if (!target.couponCode && guest.couponCode) await tx.cart.update({ where: { id: target.id }, data: { couponCode: guest.couponCode } });
      await tx.cart.delete({ where: { id: guest.id } });
    });
    return this.view(userCtx);
  }

  private async mustFind(ctx: CartContext) {
    const cart = await this.findCart(ctx);
    if (!cart) throw new NotFoundException('Cart not found');
    return cart;
  }

  private touch(cartId: string) {
    return this.prisma.cart.update({ where: { id: cartId }, data: { updatedAt: new Date() } });
  }
}
