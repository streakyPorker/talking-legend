import { Global, Module, DynamicModule } from '@nestjs/common';
import Database from 'better-sqlite3';
import { migrate } from './migrate';
import { DbConnectionManager, boundDatabaseProxy } from './db-connection-manager';
import { GameRepository } from './repositories/game.repository';
import { WorldRepository } from './repositories/world.repository';
import { NpcRepository } from './repositories/npc.repository';
import { PlayerRepository } from './repositories/player.repository';
import { StorylineRepository } from './repositories/storyline.repository';
import { LlmLogRepository } from './repositories/llm-log.repository';
import { TravelLogRepository } from './repositories/travel-log.repository';
import { SaveRepository } from './repositories/save.repository';
import { GameEventsRepository } from './repositories/game-events.repository';

export interface DbModuleConfig {
  dbPath: string;
}

import { DB_INSTANCE, DATABASE_MANAGER } from './tokens';

const REPOSITORIES = [
  GameRepository,
  WorldRepository,
  NpcRepository,
  PlayerRepository,
  StorylineRepository,
  LlmLogRepository,
  TravelLogRepository,
  SaveRepository,
  GameEventsRepository,
] as const;

@Global()
@Module({})
export class DbModule {
  static forRoot(config: DbModuleConfig): DynamicModule {
    const manager = new DbConnectionManager(config.dbPath);

    const managerProvider = {
      provide: DATABASE_MANAGER,
      useValue: manager,
    };

    const dbProvider = {
      provide: DB_INSTANCE,
      useValue: boundDatabaseProxy(manager),
    };

    return {
      module: DbModule,
      providers: [dbProvider, managerProvider, ...REPOSITORIES],
      exports: [dbProvider, managerProvider, ...REPOSITORIES],
    };
  }
}

/**
 * Factory helper for testing — creates a standalone :memory: Database
 * without the full NestJS module bootstrap.
 *
 * Usage:
 * ```ts
 * const db = createInMemoryDb();
 * const repo = new GameRepository(db);
 * ```
 */
export function createInMemoryDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}
