import { Request } from 'express';
import { RequestMeta } from '../auth-user';

export function requestMeta(req: Request): RequestMeta {
  const ua = req.headers['user-agent'];
  return { ip: req.ip, userAgent: typeof ua === 'string' ? ua.slice(0, 512) : undefined };
}

/** Mobile apps send "X-Client-Type: mobile" and get the refresh token in the body. Web gets an httpOnly cookie. */
export function isMobileClient(req: Request): boolean {
  return req.headers['x-client-type'] === 'mobile';
}

/** The admin panel sends "X-Client-Type: admin": staff-only sign in, and its own refresh cookie. */
export function isAdminClient(req: Request): boolean {
  return req.headers['x-client-type'] === 'admin';
}
