import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10), // connections per API instance
  // PEM of the database's certificate authority (hosted Postgres such as Supabase): encrypted AND verified connection
  DATABASE_CA_CERT: z.string().optional(),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 chars'),
  /** Public address of the customer website, for links in emails (guest order tracking). */
  STOREFRONT_URL: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),
  /** How the API reaches the website server to refresh its cache (internal network); defaults to STOREFRONT_URL */
  /** Admin panel address: links in staff alert emails (optional; without it the email has no link) */
  ADMIN_URL: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),
  STOREFRONT_INTERNAL_URL: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  REFRESH_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  /** Staff two-step sign-in: "required" (default in production) blocks staff tools until it is set up; "optional" lets staff choose. */
  STAFF_TWO_FACTOR: z.preprocess((v) => (v === '' ? undefined : v), z.enum(['required', 'optional']).optional()),
  /** Sign in with Google: OAuth client ids allowed as token audience (web, iOS, Android), comma separated. Empty = off. */
  GOOGLE_CLIENT_IDS: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  /** Sign in with Apple: Services ID (web) and app bundle id(s), comma separated. Empty = off. */
  APPLE_CLIENT_IDS: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  /** Key sets for checking their tokens (only changed for tests). */
  GOOGLE_JWKS_URL: z.string().url().default('https://www.googleapis.com/oauth2/v3/certs'),
  APPLE_JWKS_URL: z.string().url().default('https://appleid.apple.com/auth/keys'),
  /** Web push (VAPID). Generate once: npx web-push generate-vapid-keys. Empty = browser notifications off. */
  VAPID_PUBLIC_KEY: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  VAPID_PRIVATE_KEY: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  VAPID_SUBJECT: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  COOKIE_DOMAIN: z.string().optional(),
  DEFAULT_COUNTRY: z.string().length(2).default('QA'),
  // Shared secret for the website's server (SSR). Its public GET requests are exempt from per-IP rate limits,
  // because every visitor's page render arrives from the same server IP. Never sent to browsers.
  INTERNAL_API_KEY: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(32, 'INTERNAL_API_KEY must be at least 32 chars').optional()),

  // 32 random bytes, base64. Encrypts IBANs and other sensitive fields at rest.
  FIELD_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'FIELD_ENCRYPTION_KEY must be 32 bytes in base64'),

  // S3-compatible storage (AWS S3, Cloudflare R2, MinIO locally)
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default('auto'),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  S3_BUCKET_PUBLIC: z.string().min(1), // product images, logos (served through CDN)
  S3_BUCKET_PRIVATE: z.string().min(1), // seller documents (signed URLs only)
  PUBLIC_MEDIA_BASE_URL: z.string().url(), // e.g. https://media.fastmovex.qa

  // Optional: without it an in-process cache is used (fine for one instance, use Redis when scaling out)
  REDIS_URL: z.string().url().optional(),

  // Smallest payout a seller can request, minor units (5000 = QAR 50.00). Admin policy, not code.
  PAYOUT_MIN_MINOR: z.string().regex(/^\d{1,13}$/).default('5000'),
  // Stock one person may write off alone (value at cost, minor units); more needs inventory.approve or a stocktake
  STOCK_WRITE_OFF_LIMIT_MINOR: z.string().regex(/^\d{1,13}$/).default('50000'),

  // Notification channels. "none" = channel off, "log" = print to server log (development only).
  NOTIFY_EMAIL_DRIVER: z.enum(['none', 'log', 'resend']).default('none'),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('FastMoveX <no-reply@fastmovex.qa>'),
  NOTIFY_SMS_DRIVER: z.enum(['none', 'log', 'twilio']).default('none'),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM: z.string().optional(),
  NOTIFY_PUSH_DRIVER: z.enum(['none', 'log']).default('none'),
  // WhatsApp Business Cloud API (Meta): order updates with approved templates, only to customers who opted in
  WHATSAPP_DRIVER: z.enum(['none', 'log', 'cloud']).default('none'),
  WHATSAPP_TOKEN: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(20).optional()),
  WHATSAPP_PHONE_NUMBER_ID: z.preprocess((v) => (v === '' ? undefined : v), z.string().regex(/^\d{5,20}$/, 'WHATSAPP_PHONE_NUMBER_ID is the numeric id from WhatsApp Manager').optional()),
  WHATSAPP_API_URL: z.string().url().default('https://graph.facebook.com/v22.0'),

  // Payments — Dibsy (Qatar): cards, Apple Pay, Google Pay, Himyan/NAPS on Dibsy's hosted page
  DIBSY_SECRET_KEY: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(16, 'DIBSY_SECRET_KEY looks too short').optional()),
  DIBSY_API_URL: z.string().url().default('https://api.dibsy.one/v2'),
  /** Public https address of this API, so gateways can call the webhook (e.g. https://api.fastmovex.qa). */
  API_PUBLIC_URL: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  const env = result.data;
  // Production guard rails: things that are fine on a laptop but dangerous on a live server
  if (env.NODE_ENV === 'production') {
    const problems: string[] = [];
    // "log" drivers print one-time codes and personal data into server logs
    if (env.NOTIFY_EMAIL_DRIVER === 'log') problems.push('NOTIFY_EMAIL_DRIVER=log is not allowed in production (use resend or none)');
    if (env.NOTIFY_SMS_DRIVER === 'log') problems.push('NOTIFY_SMS_DRIVER=log is not allowed in production (use twilio or none)');
    if (env.NOTIFY_PUSH_DRIVER === 'log') problems.push('NOTIFY_PUSH_DRIVER=log is not allowed in production');
    if (env.WHATSAPP_DRIVER === 'log') problems.push('WHATSAPP_DRIVER=log is not allowed in production (use cloud or none)');
    if (env.WHATSAPP_DRIVER === 'cloud' && (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID)) problems.push('WHATSAPP_DRIVER=cloud needs WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID');
    if (/change-me|example|test-secret/i.test(env.JWT_ACCESS_SECRET)) problems.push('JWT_ACCESS_SECRET looks like a placeholder');
    if (env.CORS_ORIGINS.includes('localhost')) problems.push('CORS_ORIGINS must not contain localhost in production');
    if (env.DIBSY_SECRET_KEY && !env.API_PUBLIC_URL) problems.push('API_PUBLIC_URL is required with DIBSY_SECRET_KEY (Dibsy must reach the payment webhook)');
    if (env.DIBSY_SECRET_KEY && !env.DIBSY_API_URL.startsWith('https://')) problems.push('DIBSY_API_URL must be https in production');
    // sign-in keys must come from Google / Apple themselves (a test key server is for local tests only)
    if (env.GOOGLE_JWKS_URL !== 'https://www.googleapis.com/oauth2/v3/certs') problems.push('GOOGLE_JWKS_URL must not be changed in production');
    if (env.APPLE_JWKS_URL !== 'https://appleid.apple.com/auth/keys') problems.push('APPLE_JWKS_URL must not be changed in production');
    if (!!env.VAPID_PUBLIC_KEY !== !!env.VAPID_PRIVATE_KEY) problems.push('Set both VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY (or neither)');
    if (problems.length) throw new Error(`Unsafe production configuration:\n  ${problems.join('\n  ')}`);
  }
  return env;
}
