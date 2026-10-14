import { Prisma } from '@prisma/client';

/**
 * Vacation mode. A store with `awayUntil` in the future is closed: its products leave search, categories and home
 * rails, cannot be added to a cart or bought, and its pages say when it is back. It reopens by itself at `awayUntil`.
 * Orders placed before still have to be packed (the seller is told so when switching it on).
 */

/** For Prisma `store` filters: open now. */
export const storeOpen = (now = new Date()): Prisma.StoreWhereInput => ({ OR: [{ awayUntil: null }, { awayUntil: { lte: now } }] });

/** For raw SQL with the store aliased as `s`. */
export const STORE_OPEN_SQL = Prisma.sql`(s."awayUntil" IS NULL OR s."awayUntil" <= now())`;

export const isAway = (awayUntil: Date | null | undefined, now = new Date()) => !!awayUntil && awayUntil > now;

/** The longest holiday a seller can set in one go. */
export const MAX_AWAY_DAYS = 90;
