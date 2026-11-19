import { Global, Injectable, Logger, Module } from '@nestjs/common';

export type LatLng = { lat: number; lng: number };

/**
 * Driving time between two points from a road-routing service, for the customer's "arriving around" time.
 *   ROUTING_PROVIDER=ors   + ORS_API_KEY  -> openrouteservice.org (free tier: 2,000 routes a day)
 *   ROUTING_PROVIDER=osrm  + OSRM_URL     -> your own OSRM server (the public demo server is not for production)
 *   off (default)                          -> null, and the straight-line estimate is used
 * Never slows a page: 2-second timeout, answers cached 2 minutes per ~100 m, and any error falls back to null.
 */
@Injectable()
export class RoutingService {
  private readonly logger = new Logger(RoutingService.name);
  private readonly cache = new Map<string, { at: number; minutes: number | null }>();
  constructor(private readonly fetcher: typeof fetch = globalThis.fetch) {}

  get provider(): 'ors' | 'osrm' | 'off' {
    const p = (process.env.ROUTING_PROVIDER ?? 'off').toLowerCase();
    if (p === 'ors' && process.env.ORS_API_KEY) return 'ors';
    if (p === 'osrm' && process.env.OSRM_URL) return 'osrm';
    return 'off';
  }

  /** Minutes of driving, or null when routing is off or did not answer in time. */
  async drivingMinutes(from: LatLng, to: LatLng, now = Date.now()): Promise<number | null> {
    const provider = this.provider;
    if (provider === 'off') return null;
    const key = [from.lat, from.lng, to.lat, to.lng].map((n) => n.toFixed(3)).join(',');
    const hit = this.cache.get(key);
    if (hit && now - hit.at < 120_000) return hit.minutes;
    let minutes: number | null = null;
    try {
      const seconds = provider === 'ors' ? await this.ors(from, to) : await this.osrm(from, to);
      minutes = seconds !== null && Number.isFinite(seconds) && seconds >= 0 ? seconds / 60 : null;
    } catch (e) {
      this.logger.warn(`routing (${provider}) failed: ${(e as Error).message}`);
    }
    if (this.cache.size > 5_000) this.cache.clear();
    this.cache.set(key, { at: now, minutes });
    return minutes;
  }

  private async get(url: string, headers: Record<string, string> = {}): Promise<unknown> {
    const res = await this.fetcher(url, { headers, signal: AbortSignal.timeout(2_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  private async ors(from: LatLng, to: LatLng): Promise<number | null> {
    const url = `https://api.openrouteservice.org/v2/directions/driving-car?start=${from.lng},${from.lat}&end=${to.lng},${to.lat}`;
    const body = (await this.get(url, { Authorization: process.env.ORS_API_KEY! })) as { features?: { properties?: { summary?: { duration?: number } } }[] };
    return body.features?.[0]?.properties?.summary?.duration ?? null;
  }

  private async osrm(from: LatLng, to: LatLng): Promise<number | null> {
    const base = process.env.OSRM_URL!.replace(/\/+$/, '');
    const body = (await this.get(`${base}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false`)) as { routes?: { duration?: number }[] };
    return body.routes?.[0]?.duration ?? null;
  }
}

@Global()
@Module({ providers: [{ provide: RoutingService, useFactory: () => new RoutingService() }], exports: [RoutingService] })
export class RoutingModule {}
