import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from './config/config.service';
import { LegendLogger } from './common/logger/legend.logger';

async function bootstrap() {
  const isDev = process.env.NODE_ENV === 'development' ||
    process.env.npm_lifecycle_event?.includes('dev');

  const app = await NestFactory.create(AppModule, {
    logger: new LegendLogger(),
  });
  const config = app.get(ConfigService);
  app.setGlobalPrefix('api');
  app.enableCors();
  await app.listen(config.port);
  console.log(`Talking Legend backend running on http://localhost:${config.port}`);
}

bootstrap();
