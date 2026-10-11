import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Time-based one-time codes (RFC 6238, the codes Google Authenticator / Microsoft Authenticator / 1Password show):
 * HMAC-SHA1, 6 digits, 30-second steps. Pure functions, unit-tested against the RFC test vectors.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const STEP_SECONDS = 30;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error('Invalid base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** 160-bit secret, base32 (what the authenticator app stores). */
export function newSecret(): string {
  return base32Encode(randomBytes(20));
}

export function hotp(secret: Buffer, counter: number, digits = 6): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', secret).update(msg).digest();
  const offset = mac[mac.length - 1] & 0xf;
  const bin = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export const stepAt = (time: Date | number) => Math.floor((typeof time === 'number' ? time : time.getTime()) / 1000 / STEP_SECONDS);

export function totp(secretBase32: string, at: Date | number = Date.now(), digits = 6): string {
  return hotp(base32Decode(secretBase32), stepAt(at), digits);
}

/**
 * Checks a 6-digit code, allowing one step of clock drift either way. Returns the step it matched (so it can be
 * recorded and never accepted again), or null. Steps at or before `lastStep` are refused (replay).
 */
export function verifyTotp(secretBase32: string, code: string, at: Date | number = Date.now(), lastStep: number | null = null): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const key = base32Decode(secretBase32);
  const now = stepAt(at);
  for (const step of [now, now - 1, now + 1]) {
    if (lastStep !== null && step <= lastStep) continue;
    const expected = Buffer.from(hotp(key, step));
    if (timingSafeEqual(expected, Buffer.from(code))) return step;
  }
  return null;
}

/** otpauth:// link the authenticator app reads from the QR code. */
export function otpauthUrl(secretBase32: string, account: string, issuer = 'FastMoveX'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;
}

/** Ten one-time recovery codes, e.g. "K7QM-2XPA". Shown once; only their hashes are kept. */
export function newRecoveryCodes(n = 10): string[] {
  return Array.from({ length: n }, () => {
    const s = base32Encode(randomBytes(5)).slice(0, 8);
    return `${s.slice(0, 4)}-${s.slice(4)}`;
  });
}

export function hashRecoveryCode(code: string, pepper: string): string {
  return createHash('sha256').update(`${pepper}:${code.toUpperCase().replace(/[^A-Z2-7]/g, '')}`).digest('hex');
}

/** "Chrome on Windows", "Safari on iPhone" — a readable name for a sign-in. */
export function deviceLabel(ua: string | undefined | null): string {
  if (!ua) return 'Unknown device';
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /CrOS/.test(ua) ? 'Chromebook' : /Linux/.test(ua) ? 'Linux' : null;
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /okhttp|Dart|Flutter/i.test(ua) ? 'FastMoveX app' : /curl|node|axios|python/i.test(ua) ? 'Script' : null;
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os ?? 'Unknown device';
}

export const deviceHash = (ua: string | undefined | null) => createHash('sha256').update(ua ?? '').digest('hex');
