import { BadRequestException } from '@nestjs/common';

/** Pure rules for search-engine content (no imports from the app: safe to use anywhere). Exported for tests. */

/** A real GTIN (EAN-8, UPC-A 12, EAN-13, GTIN-14) with a correct check digit — Google rejects made-up numbers. */
export function validGtin(code: string | null | undefined): string | null {
  const s = (code ?? '').replace(/[\s-]/g, '');
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(s)) return null;
  if (/^0+$/.test(s)) return null;
  const digits = s.split('').map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((n, d, i) => n + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check ? s : null;
}

export interface FaqItem { q: string; qAr: string; a: string; aAr: string }
/** Keeps complete questions only (both languages), trimmed and limited. */
export function cleanFaq(input: unknown): FaqItem[] {
  if (!Array.isArray(input)) return [];
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  return input
    .map((x) => ({ q: str(x?.q, 200), qAr: str(x?.qAr, 200), a: str(x?.a, 1500), aAr: str(x?.aAr, 1500) }))
    .filter((x) => x.q && x.a && x.qAr && x.aAr)
    .slice(0, 20);
}

export interface SeoSettings {
  googleVerification: string | null;
  bingVerification: string | null;
  social: Partial<Record<'instagram' | 'facebook' | 'tiktok' | 'x' | 'youtube' | 'snapchat' | 'linkedin', string>>;
  /** the product feed for Google Merchant Center (free listings) is published */
  merchantFeed: boolean;
}
const SOCIAL_HOSTS: Record<keyof SeoSettings['social'], RegExp> = {
  instagram: /^https:\/\/(www\.)?instagram\.com\//i,
  facebook: /^https:\/\/(www\.|m\.)?facebook\.com\//i,
  tiktok: /^https:\/\/(www\.)?tiktok\.com\//i,
  x: /^https:\/\/(www\.)?(x|twitter)\.com\//i,
  youtube: /^https:\/\/(www\.)?youtube\.com\//i,
  snapchat: /^https:\/\/(www\.)?snapchat\.com\//i,
  linkedin: /^https:\/\/(www\.)?linkedin\.com\//i,
};
/** Settings for search engines. Verification codes are the `content` of the meta tag only; social links must be the network's own https address. */
export function parseSeoSettings(input: unknown, strict = true): SeoSettings {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const code = (v: unknown, name: string) => {
    if (v === undefined || v === null || v === '') return null;
    // people paste the whole <meta …> tag: take its content
    const raw = String(v).trim();
    const m = /content=["']([^"']+)["']/i.exec(raw);
    const value = (m ? m[1] : raw).trim();
    if (!/^[A-Za-z0-9_-]{6,100}$/.test(value)) {
      if (strict) throw new BadRequestException(`${name}: paste the verification code (letters, numbers, - and _)`);
      return null;
    }
    return value;
  };
  const social: SeoSettings['social'] = {};
  const s = (o.social && typeof o.social === 'object' ? o.social : {}) as Record<string, unknown>;
  for (const key of Object.keys(SOCIAL_HOSTS) as (keyof SeoSettings['social'])[]) {
    const v = typeof s[key] === 'string' ? (s[key] as string).trim() : '';
    if (!v) continue;
    if (!SOCIAL_HOSTS[key].test(v) || v.length > 200 || /[\s<>"']/.test(v)) {
      if (strict) throw new BadRequestException(`${key}: enter the full https:// address of your ${key} page`);
      continue;
    }
    social[key] = v;
  }
  return { googleVerification: code(o.googleVerification, 'Google'), bingVerification: code(o.bingVerification, 'Bing'), social, merchantFeed: o.merchantFeed !== false };
}

