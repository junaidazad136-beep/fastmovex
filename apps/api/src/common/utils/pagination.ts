import { BadRequestException } from '@nestjs/common';

export interface Cursor {
  createdAt: Date;
  id: string;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify({ t: c.createdAt.toISOString(), i: c.id })).toString('base64url');
}

export function decodeCursor(raw?: string): Cursor | undefined {
  if (!raw) return undefined;
  try {
    const { t, i } = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    const createdAt = new Date(t);
    if (typeof i !== 'string' || Number.isNaN(createdAt.getTime())) throw new Error();
    return { createdAt, id: i };
  } catch {
    throw new BadRequestException('Invalid cursor');
  }
}

/** Keyset condition for ORDER BY createdAt DESC, id DESC. Stable even when rows are inserted meanwhile. */
export function afterCursor(c?: Cursor) {
  if (!c) return {};
  return { OR: [{ createdAt: { lt: c.createdAt } }, { createdAt: c.createdAt, id: { lt: c.id } }] };
}

/** Fetch limit+1 rows, pass them here: returns the page and the next cursor. */
export function toPage<T extends { createdAt: Date; id: string }>(rows: T[], limit: number): Page<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return { items, nextCursor: hasMore && last ? encodeCursor(last) : null };
}
