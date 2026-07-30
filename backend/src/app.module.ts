import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { ConfigModule } from './config/config.module';
import { DbModule } from './db/db.module';
import { GameModule } from './game/game.module';
import { NpcModule } from './npc/npc.module';
import { WorldModule } from './world/world.module';
import { StorylineModule } from './storyline/storyline.module';
import { LlmModule } from './llm/llm.module';
import { WorldConfigModule } from './world-config/world-config.module';
import { RequestMethod, type NestModule, type MiddlewareConsumer } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

@Module({
  imports: [
    // 托管前端静态文件 → 前后端单端口 (:31943)
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', '..', 'frontend', 'dist'),
      serveRoot: '/',
      exclude: ['/api/(.*)'],
    }),
    ConfigModule,
    WorldConfigModule,
    DbModule.forRoot({ dbPath: './data/talking-legend.db' }),
    LlmModule,
    GameModule,
    NpcModule,
    WorldModule,
    StorylineModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply((req: Request, res: Response, next: NextFunction) => {
        if (req.method === 'GET' && !req.path.startsWith('/api/') && !req.path.includes('.')) {
          return res.sendFile(join(__dirname, '..', '..', 'frontend', 'dist', 'index.html'));
        }
        next();
      })
      .forRoutes({ path: '(.*)', method: RequestMethod.GET });
  }
}
