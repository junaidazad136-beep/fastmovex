/**
 * TLS to a hosted database (Supabase, Neon, RDS…): with DATABASE_CA_CERT (the provider's CA certificate, PEM; "\n"
 * escapes allowed for one-line env values; a certificate pasted into a one-line box, with its line breaks turned into spaces,
 * is rebuilt) the connection is encrypted and the server certificate verified against
 * that CA. sslmode / sslrootcert in the URL are then dropped for the pool (node-postgres would let them override the
 * CA), but stay in DATABASE_URL for the Prisma CLI. Without it the URL decides (local Postgres: plain).
 */
export function poolTls(url: string, caCert?: string): { connectionString: string; ssl?: { ca: string; rejectUnauthorized: true } } {
  const ca = normalizePem(caCert);
  if (!ca) return { connectionString: url };
  const u = new URL(url);
  for (const k of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'ssl', 'uselibpqcompat']) u.searchParams.delete(k);
  return { connectionString: u.toString(), ssl: { ca, rejectUnauthorized: true } };
}

/** PEM text as node's TLS expects it: "\n" escapes become line breaks, and blocks flattened onto one line are rebuilt. */
export function normalizePem(raw?: string): string {
  const text = (raw ?? '').trim().replace(/\\n/g, '\n').replace(/\r\n?/g, '\n');
  if (!text) return '';
  const blocks = [...text.matchAll(/-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/g)];
  if (!blocks.length) return text;
  return blocks
    .map(([, label, body]) => {
      const b64 = body.replace(/\s+/g, '');
      return [`-----BEGIN ${label}-----`, ...(b64.match(/.{1,64}/g) ?? []), `-----END ${label}-----`].join('\n');
    })
    .join('\n') + '\n';
}
