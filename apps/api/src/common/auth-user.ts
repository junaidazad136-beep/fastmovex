export interface AuthUser {
  id: string;
  roles: string[];
  permissions: string[];
  /** this session passed the two-step code */
  mfa?: boolean;
  /** the sign-in (refresh-token family) this access token belongs to */
  sessionId?: string;
}

export interface AccessTokenPayload {
  sub: string;
  roles: string[];
  perms: string[];
  typ: 'access';
  mfa?: boolean;
  sid?: string;
}

export interface SellerContext {
  id: string;
  status: string;
  countryCode: string;
}

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
}
