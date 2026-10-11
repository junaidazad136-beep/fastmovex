import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterDto } from '../src/auth/dto/auth.dto';
import { validateEnv } from '../src/config/env';

async function errorsFor(body: object) {
  const errs = await validate(plainToInstance(RegisterDto, body));
  return errs.map((e) => e.property);
}

describe('RegisterDto validation', () => {
  it('accepts email-only signup', async () => {
    expect(await errorsFor({ fullName: 'Junaid', email: 'J@X.com', password: 'abc12345' })).toEqual([]);
  });
  it('accepts Qatar phone-only signup', async () => {
    expect(await errorsFor({ fullName: 'Junaid', phone: '+97455555555', password: 'abc12345' })).toEqual([]);
  });
  it('rejects when neither email nor phone', async () => {
    expect(await errorsFor({ fullName: 'Junaid', password: 'abc12345' })).toEqual(expect.arrayContaining(['email', 'phone']));
  });
  it('rejects weak password', async () => {
    expect(await errorsFor({ fullName: 'Junaid', email: 'a@b.com', password: 'abcdefgh' })).toContain('password');
  });
  it('rejects local-format phone', async () => {
    expect(await errorsFor({ fullName: 'Junaid', phone: '55555555', password: 'abc12345' })).toContain('phone');
  });
});

describe('env validation', () => {
  it('refuses to boot with a short JWT secret', () => {
    expect(() => validateEnv({ DATABASE_URL: 'postgres://x', JWT_ACCESS_SECRET: 'short' })).toThrow('JWT_ACCESS_SECRET');
  });
  it('applies Qatar defaults', () => {
    const env = validateEnv({
      DATABASE_URL: 'postgres://x', JWT_ACCESS_SECRET: 'k'.repeat(40), FIELD_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
      S3_ACCESS_KEY_ID: 'x', S3_SECRET_ACCESS_KEY: 'x', S3_BUCKET_PUBLIC: 'p', S3_BUCKET_PRIVATE: 'q', PUBLIC_MEDIA_BASE_URL: 'https://m.test',
    });
    expect(env.DEFAULT_COUNTRY).toBe('QA');
    expect(env.JWT_ACCESS_TTL_SECONDS).toBe(900);
  });
});
