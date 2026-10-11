import 'server-only';

/**
 * Runtime configuration, read on the server at request time (not baked into the build),
 * so one Docker image can run in staging and production.
 */
export const env = {
  /** Where the Next.js server reaches the API (private network in production). */
  apiInternalUrl: (process.env.API_INTERNAL_URL || process.env.PUBLIC_API_URL || 'http://localhost:4000/api/v1').replace(/\/$/, ''),
  /** Where browsers reach the API. */
  publicApiUrl: (process.env.PUBLIC_API_URL || 'http://localhost:4000/api/v1').replace(/\/$/, ''),
  siteUrl: (process.env.SITE_URL || 'http://localhost:3000').replace(/\/$/, ''),
  internalApiKey: process.env.INTERNAL_API_KEY || '',
  defaultCountry: (process.env.DEFAULT_COUNTRY || 'QA').toUpperCase(),
};

export interface PublicConfig {
  apiUrl: string;
  siteUrl: string;
  country: string;
}

export function publicConfig(): PublicConfig {
  return { apiUrl: env.publicApiUrl, siteUrl: env.siteUrl, country: env.defaultCountry };
}
