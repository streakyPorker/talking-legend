import { Global, Module, DynamicModule } from '@nestjs/common';
import Database from 'better-sqlite3';
import { migrate } from './migrate';
import { GameRepository } from './repositories/game.repository';
import { WorldRepository } from './repositories/world.repository';
import { NpcRepository } from './repositories/npc.repository';
import { PlayerRepository } from './repositories/player.repository';
import { StorylineRepository } from './repositories/storyline.repository';
import { LlmLogRepository } from './repositories/llm-log.repository';

export interface DbModuleConfig {
  dbPath: string;
}

import { DB_INSTANCE } from './tokens';

const REPOSITORIES = [
  GameRepository,
  WorldRepository,
  NpcRepository,
  PlayerRepository,
  StorylineRepository,
  LlmLogRepository,
] as const;

@Global()
@Module({})
export class DbModule {
  static forRoot(config: DbModuleConfig): DynamicModule {
    const db = new Database(config.dbPath);

    // WAL mode for read concurrency; synchronous=NORMAL is safe under WAL
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('foreign_keys = ON');

    // Run pending schema migrations
    migrate(db);

    const dbProvider = {
      provide: DB_INSTANCE,
      useValue: db,
    };

    return {
      module: DbModule,
      providers: [dbProvider, ...REPOSITORIES],
      exports: [dbProvider, ...REPOSITORIES],
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
