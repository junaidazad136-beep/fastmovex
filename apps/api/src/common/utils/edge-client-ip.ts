import { timingSafeEqual } from 'crypto';
import { isIP } from 'net';
import type { NextFunction, Request, Response } from 'express';

/**
 * The website (and admin) serve the API under their own address (/api/v1 on vercel.app), so every customer's request
 * reaches the API from the website's host — one IP for many shoppers, and the per-IP rate limits would treat them as one
 * visitor ("Too many requests" for everybody at busy times).
 *
 * The website's proxy therefore sends the shopper's real IP in `x-fmx-client-ip`, together with the shared
 * INTERNAL_API_KEY in `x-fmx-edge-key`. Only a request carrying the right key may set its client IP; anyone else's
 * header is ignored and removed, so the rate limits cannot be dodged by sending a made-up IP.
 * (A different header from `x-internal-key`, which marks the website's own server reads and skips rate limits.)
 */
export const EDGE_IP_HEADER = 'x-fmx-client-ip';
export const EDGE_KEY_HEADER = 'x-fmx-edge-key';

type Headers = Record<string, string | string[] | undefined>;

/** The shopper's IP the website vouched for, or null when the request is not from our website (or the IP is not one). */
export function edgeClientIp(headers: Headers, key: string | undefined): string | null {
  if (!key || key.length < 32) return null;
  const sent = headers[EDGE_KEY_HEADER];
  const ip = headers[EDGE_IP_HEADER];
  if (typeof sent !== 'string' || typeof ip !== 'string') return null;
  const a = Buffer.from(sent);
  const b = Buffer.from(key);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const clean = ip.trim();
  return isIP(clean) ? clean : null;
}

/** Express middleware: `req.ip` becomes the shopper's IP for vouched requests; the two headers never go further. */
export function edgeClientIpMiddleware(key: string | undefined) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const ip = edgeClientIp(req.headers, key);
    delete req.headers[EDGE_IP_HEADER];
    delete req.headers[EDGE_KEY_HEADER];
    if (ip) {
      Object.defineProperty(req, 'ip', { value: ip, configurable: true, enumerable: true });
      Object.defineProperty(req, 'ips', { value: [ip], configurable: true, enumerable: true });
    }
    next();
  };
}
