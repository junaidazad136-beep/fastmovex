import { randomBytes } from 'crypto';

/** "iPhone 15 Pro — 256GB!" -> "iphone-15-pro-256gb". Arabic-only titles fall back to "item". */
export function slugify(input: string, maxLength = 60): string {
  const slug = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
  return slug || 'item';
}

/** Slug with a short random suffix so it is unique without a DB round-trip race. */
export function uniqueSlug(input: string): string {
  return `${slugify(input, 50)}-${randomBytes(3).toString('hex')}`;
}
