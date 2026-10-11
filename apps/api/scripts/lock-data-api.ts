// Supabase (and similar hosts) can expose every table in "public" through an automatic REST / GraphQL API to the
// public "anon" key. FastMoveX never uses that API: only the FastMoveX server talks to the database. This takes the API roles'
// access away, also from tables added later. Does nothing on a database without those roles (local, Docker, RDS).
// Run after migrations: `npx tsx scripts/lock-data-api.ts` (scripts/render-build.sh does).
import 'dotenv/config';
import { Client } from 'pg';
import { poolTls } from '../src/prisma/pool-tls';

const SQL = `DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated';
    EXECUTE 'REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated';
  END IF;
END $$`;

async function main() {
  const db = new Client(poolTls(process.env.DATABASE_URL ?? '', process.env.DATABASE_CA_CERT));
  await db.connect();
  try {
    await db.query(SQL);
    const { rows } = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM information_schema.role_table_grants WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated')`,
    );
    if (rows[0].n !== '0') throw new Error(`${rows[0].n} table permissions still open to the public API roles`);
    console.log('Database: tables are not reachable through a public data API.');
  } finally {
    await db.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
