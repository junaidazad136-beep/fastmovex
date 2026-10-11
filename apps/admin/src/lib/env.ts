/**
 * Runtime configuration, read on the server at request time (not baked into the build),
 * so one Docker image runs in staging and production. Only public values live here: the admin
 * panel talks to the API from the browser with the staff member's own token.
 */
export const env = {
  /** Where browsers reach the API (ends with /api/v1). */
  publicApiUrl: (process.env.PUBLIC_API_URL || 'http://localhost:4000/api/v1').replace(/\/$/, ''),
  /** The customer website, for "View on store" links. */
  storefrontUrl: (process.env.STOREFRONT_URL || 'http://localhost:3000').replace(/\/$/, ''),
  /** Media origin (product photos), allowed in the Content-Security-Policy. */
  mediaUrl: process.env.MEDIA_URL || '',
  defaultCountry: (process.env.DEFAULT_COUNTRY || 'QA').toUpperCase(),
  /**
   * Map tiles for the drivers' live map ({z}/{x}/{y}, optional {s}). Default OpenStreetMap, fine for a few staff
   * screens; use a tile provider's URL (with its key) for heavier use. "none" shows the pins without a background map.
   */
  mapTileUrl: process.env.MAP_TILE_URL === 'none' ? '' : process.env.MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  mapAttribution: process.env.MAP_ATTRIBUTION || '© OpenStreetMap contributors',
};

/** The tile server's origin for the CSP ("https://{s}.tile.x.org/…" → "https://*.tile.x.org"). */
export function tileOrigin(url: string): string {
  const m = /^(https:\/\/[^/]+)/.exec(url);
  return m ? m[1].replace(/\{s\}/g, '*') : '';
}

export interface PublicConfig {
  apiUrl: string;
  storefrontUrl: string;
  country: string;
  mapTileUrl: string;
  mapAttribution: string;
}

export function publicConfig(): PublicConfig {
  return { apiUrl: env.publicApiUrl, storefrontUrl: env.storefrontUrl, country: env.defaultCountry, mapTileUrl: env.mapTileUrl, mapAttribution: env.mapAttribution };
}
