import { Global, Logger, Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { Env } from '../config/env';

/** Small JSON cache. Values must be JSON-safe (convert BigInt to string before caching). */
export abstract class CacheService {
  abstract get<T>(key: string): Promise<T | undefined>;
  abstract set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  abstract del(...keys: string[]): Promise<void>;

  /** Read-through helper: returns cached value or computes, stores and returns it. */
  async wrap<T>(key: string, ttlSeconds: number, compute: () => Promise<T>): Promise<T> {
    const hit = await this.get<T>(key);
    if (hit !== undefined) return hit;
    const value = await compute();
    await this.set(key, value, ttlSeconds);
    return value;
  }
}

const serialize = (v: unknown) => JSON.stringify(v, (_k, val) => (typeof val === 'bigint' ? val.toString() : val));

export class MemoryCacheService extends CacheService {
  private readonly store = new Map<string, { exp: number; json: string }>();
  private static readonly MAX_KEYS = 5_000;

  async get<T>(key: string) {
    const e = this.store.get(key);
    if (!e) return undefined;
    if (e.exp < Date.now()) { this.store.delete(key); return undefined; }
    return JSON.parse(e.json) as T;
  }
  async set(key: string, value: unknown, ttl: number) {
    if (this.store.size >= MemoryCacheService.MAX_KEYS) this.store.delete(this.store.keys().next().value as string);
    this.store.set(key, { exp: Date.now() + ttl * 1000, json: serialize(value) });
  }
  async del(...keys: string[]) {
    keys.forEach((k) => this.store.delete(k));
  }
}

export class RedisCacheService extends CacheService implements OnModuleDestroy {
  private readonly logger = new Logger('RedisCache');
  constructor(private readonly redis: Redis) { super(); }

  /** Cache must never take the site down: Redis errors degrade to cache-miss. */
  async get<T>(key: string) {
    try {
      const raw = await this.redis.get(`fmx:${key}`);
      return raw ? (JSON.parse(raw) as T) : undefined;
    } catch (e) {
      this.logger.warn(`get failed: ${(e as Error).message}`);
      return undefined;
    }
  }
  async set(key: string, value: unknown, ttl: number) {
    try { await this.redis.set(`fmx:${key}`, serialize(value), 'EX', ttl); } catch (e) { this.logger.warn(`set failed: ${(e as Error).message}`); }
  }
  async del(...keys: string[]) {
    if (!keys.length) return;
    try { await this.redis.del(...keys.map((k) => `fmx:${k}`)); } catch (e) { this.logger.warn(`del failed: ${(e as Error).message}`); }
  }
  async onModuleDestroy() {
    await this.redis.quit().catch(() => undefined);
  }
}

@Global()
@Module({
  providers: [
    {
      provide: CacheService,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const url = config.get('REDIS_URL', { infer: true });
        if (!url) return new MemoryCacheService();
        return new RedisCacheService(new Redis(url, { maxRetriesPerRequest: 2, enableOfflineQueue: false, lazyConnect: false }));
      },
    },
  ],
  exports: [CacheService],
})
export class CacheModule {}
