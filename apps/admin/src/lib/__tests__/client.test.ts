import { describe, expect, it } from 'vitest';
import { decodeToken } from '../api/client';

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');

describe('reading the access token for the menu', () => {
  it('reads roles and permissions (the API still checks every call)', () => {
    const token = `${b64({ alg: 'HS256' })}.${b64({ sub: 'u1', roles: ['ADMIN'], perms: ['orders.read'], exp: 1 })}.sig`;
    expect(decodeToken(token)).toEqual({ sub: 'u1', roles: ['ADMIN'], perms: ['orders.read'], exp: 1 });
  });
  it('never throws on garbage', () => {
    expect(decodeToken('nope')).toBeNull();
    expect(decodeToken(null)).toBeNull();
  });
});
