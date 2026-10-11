import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../config/env';

/**
 * Tells the website to drop cached pages data right after staff change something (settings, pages, the home page,
 * a product), so customers see it on their next visit instead of after the cache time. Fire-and-forget: if the
 * website cannot be reached, its normal cache time still applies.
 */
@Injectable()
export class StorefrontService {
  private readonly logger = new Logger(StorefrontService.name);
  private readonly url: string | undefined;
  private readonly key: string | undefined;

  constructor(config: ConfigService<Env, true>) {
    const base = config.get('STOREFRONT_INTERNAL_URL', { infer: true }) ?? config.get('STOREFRONT_URL', { infer: true });
    this.url = base ? `${base.replace(/\/+$/, '')}/api/revalidate` : undefined;
    this.key = config.get('INTERNAL_API_KEY', { infer: true }) || undefined;
  }

  refresh(...tags: string[]): void {
    if (!this.url || !this.key || !tags.length) return;
    void fetch(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-key': this.key },
      body: JSON.stringify({ tags: [...new Set(tags)].slice(0, 20) }),
      signal: AbortSignal.timeout(3_000),
    })
      .then((r) => { if (!r.ok) this.logger.warn(`website refresh ${tags.join(',')}: HTTP ${r.status}`); })
      .catch((e: Error) => this.logger.warn(`website refresh ${tags.join(',')} failed: ${e.message}`));
  }
}

@Global()
@Module({ providers: [StorefrontService], exports: [StorefrontService] })
export class StorefrontModule {}
