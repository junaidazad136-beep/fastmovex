// Uses the real .env (database, storage). Never point this at production: it creates test accounts and orders.
import 'dotenv/config';

process.env.TZ = 'UTC'; // like the API itself (src/common/utc.ts)
process.env.NODE_ENV = 'test'; // background schedulers off, test payment provider allowed
process.env.RATE_LIMIT_DISABLED = 'true'; // the flow logs in many times per minute
process.env.NOTIFY_EMAIL_DRIVER ??= 'log';
process.env.NOTIFY_SMS_DRIVER ??= 'log';

if (!process.env.DATABASE_URL) throw new Error('Integration tests need DATABASE_URL (see TESTING.md)');
if (/prod/i.test(process.env.DATABASE_URL)) throw new Error('Refusing to run integration tests against a database that looks like production');
