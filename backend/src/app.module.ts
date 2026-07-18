import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from './config/config.module';
import { DbModule } from './db/db.module';
import { GameModule } from './game/game.module';
import { NpcModule } from './npc/npc.module';
import { WorldModule } from './world/world.module';
import { StorylineModule } from './storyline/storyline.module';
import { LlmModule } from './llm/llm.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

@Module({
  imports: [
    ConfigModule,
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
export class AppModule {}
