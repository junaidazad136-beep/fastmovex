import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { Env } from '../config/env';
import { poolTls } from './pool-tls';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly pool: Pool;

  constructor(config: ConfigService<Env, true>) {
    // node-postgres pool, owned here so shutdown can wait for work still running. Size it to your Postgres plan.
    const { connectionString, ssl } = poolTls(config.get('DATABASE_URL', { infer: true }), config.get('DATABASE_CA_CERT', { infer: true }));
    const pool = new Pool({
      connectionString,
      ssl,
      max: config.get('DATABASE_POOL_MAX', { infer: true }),
      // Timestamps are stored as UTC. Pin the session time zone so SQL like now() and date_trunc(... AT TIME ZONE ...)
      // behaves the same on every server, whatever the database's default time zone is.
      options: '-c TimeZone=UTC',
    });
    super({ adapter: new PrismaPg(pool), transactionOptions: { maxWait: 5_000, timeout: 15_000 } });
    this.pool = pool;
  }

  async onModuleInit() {
    await this.$connect();
  }

  /**
   * Graceful shutdown: background work started just before (notifications, delivery updates) may still be writing.
   * Wait until the pool has been idle for a moment (5 s at most), then close — never hang a deploy on it.
   */
  async onModuleDestroy() {
    const until = Date.now() + 5_000;
    let quietSince = Date.now();
    while (Date.now() < until) {
      if (this.pool.totalCount > this.pool.idleCount || this.pool.waitingCount > 0) quietSince = Date.now();
      else if (Date.now() - quietSince >= 250) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    await Promise.race([this.$disconnect(), new Promise((r) => setTimeout(r, 3_000))]);
    await Promise.race([this.pool.end().catch(() => undefined), new Promise((r) => setTimeout(r, 3_000))]);
  }
}
