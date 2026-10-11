import { ExecutionContext } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';

export const INTERNAL_KEY_HEADER = 'x-internal-key';

type Req = { method?: string; headers: Record<string, string | string[] | undefined> };

/** Constant-time check that a request comes from our own website server (SSR), via INTERNAL_API_KEY. */
export function hasInternalKey(req: Req, key = process.env.INTERNAL_API_KEY): boolean {
  if (!key || key.length < 32) return false;
  const sent = req.headers[INTERNAL_KEY_HEADER];
  if (typeof sent !== 'string') return false;
  const a = Buffer.from(sent);
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Read-only requests from the website server skip per-IP rate limits (every visitor's render comes from one IP). */
export function isTrustedInternalRead(ctx: ExecutionContext, key = process.env.INTERNAL_API_KEY): boolean {
  if (ctx.getType() !== 'http') return false;
  const req = ctx.switchToHttp().getRequest<Req>();
  return req.method === 'GET' && hasInternalKey(req, key);
}
