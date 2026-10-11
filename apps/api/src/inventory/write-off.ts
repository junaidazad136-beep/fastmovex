import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AuthUser } from '../common/auth-user';
import { formatMoney } from '../notifications/templates';
import { PrismaService } from '../prisma/prisma.service';

/** Value of stock one person may remove on their own (minor units, at cost price — or selling price when no cost is set). */
export const writeOffLimitMinor = () => BigInt(process.env.STOCK_WRITE_OFF_LIMIT_MINOR || '50000');

/** Removal reasons and which way they go: write-offs only take stock away, "found" and restocks only add. */
export const OUT_ONLY = ['DAMAGED', 'EXPIRED', 'LOST'] as const;
export const IN_ONLY = ['RESTOCK', 'FOUND'] as const;

export function assertReasonDirection(reason: string, delta: number) {
  if ((OUT_ONLY as readonly string[]).includes(reason) && delta > 0) throw new BadRequestException(`${reason.toLowerCase()} only removes stock: use a negative quantity`);
  if ((IN_ONLY as readonly string[]).includes(reason) && delta < 0) throw new BadRequestException(`${reason.toLowerCase()} only adds stock: use a positive quantity`);
}

/**
 * Taking stock away is where goods quietly disappear. Above the limit, a manager (inventory.approve) must do it —
 * or it goes through a stocktake, which needs a second person anyway.
 */
export async function assertWriteOffAllowed(prisma: PrismaService, actor: Pick<AuthUser, 'permissions'>, variantId: string, delta: number) {
  if (delta >= 0 || actor.permissions.includes('inventory.approve')) return;
  const v = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId }, select: { sku: true, priceMinor: true, costPriceMinor: true, product: { select: { country: { select: { currencyCode: true } } } } } });
  const value = (v.costPriceMinor ?? v.priceMinor) * BigInt(-delta);
  if (value > writeOffLimitMinor()) {
    throw new ForbiddenException({
      message: `Removing ${-delta} × ${v.sku} (worth ${formatMoney(value, v.product.country.currencyCode)}) needs a manager's approval. Ask a manager, or count it in a stocktake.`,
      reason: 'WRITE_OFF_APPROVAL',
    });
  }
}
