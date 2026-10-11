// Test-only environment. Loaded by Jest before any module import (ConfigModule validates at import time).
Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/jovia_test',
  JWT_ACCESS_SECRET: 'test-secret-'.padEnd(48, 'x'),
  FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 2).toString('base64'),
  S3_ACCESS_KEY_ID: 'test', S3_SECRET_ACCESS_KEY: 'test',
  S3_BUCKET_PUBLIC: 'jovia-public-test', S3_BUCKET_PRIVATE: 'jovia-private-test',
  PUBLIC_MEDIA_BASE_URL: 'https://media.test',
});
