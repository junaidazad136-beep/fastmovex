import './common/utc'; // must stay first: everything below runs in UTC
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { Env } from './config/env';

async function bootstrap() {
  // rawBody: payment webhook signatures are checked against the exact bytes
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true, rawBody: true });
  configureApp(app);
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const isProd = config.get('NODE_ENV', { infer: true }) === 'production';

  if (!isProd) {
    const doc = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('FastMoveX API').setVersion('1.0').addBearerAuth().build());
    SwaggerModule.setup('api/docs', app, doc);
  }

  const port = config.get('PORT', { infer: true });
  await app.listen(port, '0.0.0.0');
  Logger.log(`FastMoveX API on :${port}${isProd ? '' : `  docs: http://localhost:${port}/api/docs`}`, 'Bootstrap');
}

void bootstrap();
