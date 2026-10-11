import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { text } from 'express';
import helmet from 'helmet';
import { Env } from './config/env';

// Money is BigInt minor units. JSON has no BigInt, so it goes over the wire as a string: "10000" = QAR 100.00
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function (this: bigint) {
  return this.toString();
};

/** Everything that makes the HTTP layer behave like production. Shared by main.ts and the integration tests. */
export function configureApp(app: INestApplication) {
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const express = app as NestExpressApplication;
  express.set('trust proxy', 1); // real client IP behind Railway/Render/Cloudflare, needed for rate limits
  app.use(helmet());
  app.use(compression());
  app.use(cookieParser());
  express.useBodyParser('json', { limit: '1mb' });
  // Visit analytics arrive as text/plain (navigator.sendBeacon / no-cors fetch: no CORS preflight when a page closes).
  // Only on that one route, so no other endpoint ever accepts a cross-site "simple" text body.
  app.use('/api/v1/analytics/events', text({ type: 'text/plain', limit: '64kb' }));
  app.enableCors({ origin: config.get('CORS_ORIGINS', { infer: true }).split(',').map((o) => o.trim()), credentials: true, exposedHeaders: ['Content-Disposition'] }); // so the apps can name downloaded files (invoices, data export)
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, stopAtFirstError: false }));
  app.enableShutdownHooks();
  return app;
}
