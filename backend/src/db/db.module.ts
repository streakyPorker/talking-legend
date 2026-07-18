import { Global, Module, DynamicModule } from '@nestjs/common';

export interface DbModuleConfig {
  dbPath: string;
}

export const DB_INSTANCE = Symbol('DB_INSTANCE');

/**
 * In-memory Map placeholder for the skeleton phase.
 * Will be replaced with better-sqlite3 Database in RFC-002.
 */
type SkeletonDb = Map<string, Map<string, unknown>>;

@Global()
@Module({})
export class DbModule {
  static forRoot(config: DbModuleConfig): DynamicModule {
    // Placeholder: use in-memory Map until better-sqlite3 is installed
    const db: SkeletonDb = new Map();

    const dbProvider = {
      provide: DB_INSTANCE,
      useValue: db,
    };

    return {
      module: DbModule,
      providers: [dbProvider],
      exports: [dbProvider],
    };
  }
}
