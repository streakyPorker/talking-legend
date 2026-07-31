import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from './config/config.service';
import { LegendLogger } from './common/logger/legend.logger';
import { join } from 'path';
import express from 'express';

async function bootstrap() {
  const isDev = process.env.NODE_ENV === 'development' ||
    process.env.npm_lifecycle_event?.includes('dev');

  const app = await NestFactory.create(AppModule, {
    logger: new LegendLogger(),
  });
  const config = app.get(ConfigService);
  app.setGlobalPrefix('api');
  app.enableCors();

  // 托管前端静态文件 + SPA fallback（express 原生，绕过 NestJS 中间件链）
  const frontendDir = join(__dirname, '..', '..', 'frontend', 'dist');
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.use(express.static(frontendDir));
  expressApp.get(/^\/(?!api\/).*/, (_req: any, res: any) => {
    if (!_req.path.includes('.')) {
      res.sendFile(join(frontendDir, 'index.html'));
    }
  });

  await app.listen(config.port);
  console.log(`Talking Legend backend running on http://localhost:${config.port}`);
}

bootstrap();
