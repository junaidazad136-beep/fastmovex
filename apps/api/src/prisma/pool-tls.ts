/**
 * TLS to a hosted database (Supabase, Neon, RDS…): with DATABASE_CA_CERT (the provider's CA certificate, PEM; "\n"
 * escapes allowed for one-line env values) the connection is encrypted and the server certificate verified against
 * that CA. sslmode / sslrootcert in the URL are then dropped for the pool (node-postgres would let them override the
 * CA), but stay in DATABASE_URL for the Prisma CLI. Without it the URL decides (local Postgres: plain).
 */
export function poolTls(url: string, caCert?: string): { connectionString: string; ssl?: { ca: string; rejectUnauthorized: true } } {
  const ca = caCert?.trim().replace(/\\n/g, '\n');
  if (!ca) return { connectionString: url };
  const u = new URL(url);
  for (const k of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'ssl', 'uselibpqcompat']) u.searchParams.delete(k);
  return { connectionString: u.toString(), ssl: { ca, rejectUnauthorized: true } };
}
