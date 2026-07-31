import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import { migrate } from './migrate';
import { LegendLogger } from '../common/logger/legend.logger';

/**
 * Wrap the DB_INSTANCE token in a Proxy that always forwards method/property
 * access to the *current* live connection held by the manager. Functions
 * returned through the proxy are bound to the live connection so that calls
 * like `db.transaction(...)` / `db.prepare(...)` keep a correct `this` even
 * after a `reset()` connection swap.
 */
export function boundDatabaseProxy(manager: DbConnectionManager): Database.Database {
  return new Proxy({} as Database.Database, {
    get(_target, prop: string | symbol) {
      const value = (manager.db as unknown as Record<string, unknown>)[prop as string];
      if (typeof value === 'function') {
        return (value as (...args: unknown[]) => unknown).bind(manager.db);
      }
      return value;
    },
    set(_target, prop: string | symbol, value: unknown) {
      (manager.db as unknown as Record<string, unknown>)[prop as string] = value;
      return true;
    },
  });
}

/**
 * Owns the single live better-sqlite3 connection for the backend.
 *
 * Repositories and services obtain the *current* Database through the
 * `DB_INSTANCE` token (a bound proxy that always forwards to whatever
 * connection this manager currently holds). Because statements are prepared
 * lazily against that proxy, a connection swap via `reset()` transparently
 * re-derives every statement without any rebind coordination.
 *
 * Design notes:
 *  - WAL mode + `synchronous=NORMAL` for read concurrency (safe under WAL).
 *  - `reset(snapshotPath)` closes the old connection, copies a save snapshot
 *    over the main DB file, clears stale `-wal`/`-shm` files, then reopens and
 *    re-migrates. Used by the load-save flow (RFC-017).
 */
@Injectable()
export class DbConnectionManager implements OnModuleDestroy {
  private readonly logger = new LegendLogger(DbConnectionManager.name);
  private _db: Database.Database;

  /** Path of the main runtime DB file (used by load to restore snapshots). */
  productionPath: string;

  constructor(dbPath: string) {
    this.productionPath = dbPath;
    this._db = this.open(dbPath);
  }

  /** The live Database connection. */
  get db(): Database.Database {
    return this._db;
  }

  /**
   * Swap the live connection to a snapshot copy.
   *
   * Order matters: read metadata from the CURRENT connection before calling
   * this. On swap: close the current connection (releases -shm/-wal), copy the
   * snapshot file over the production/main DB path, delete any leftover
   * -wal/-shm (whose page framing belonged to the old connection and would
   * otherwise fail the checksum), reopen with pragmas, and re-run migrations.
   *
   * @param snapshotPath source snapshot DB (e.g. data/saves/slot_1.db)
   */
  reset(snapshotPath: string): void {
    const old = this._db;
    try {
      // 1. Close current connection cleanly (flushes/removes -shm/-wal).
      old.close();
    } catch (err) {
      this.logger.warn(`closing old DB during reset: ${err instanceof Error ? err.message : String(err)}`);
    }

    try {
      // 2. Copy the snapshot over the production DB path.
      fs.copyFileSync(snapshotPath, this.productionPath);

      // 3. Remove stale sidecar files (tied to the old connection).
      const wal = `${this.productionPath}-wal`;
      const shm = `${this.productionPath}-shm`;
      if (this.exists(wal)) this.rm(wal);
      if (this.exists(shm)) this.rm(shm);
    } catch (err) {
      this.logger.warn(`restoring snapshot during reset: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 4. Reopen with pragmas + migrations.
    this._db = this.open(this.productionPath);
    this.logger.log(`connection reset from snapshot: ${snapshotPath}`);
  }

  private open(dbPath: string): Database.Database {
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('foreign_keys = ON');
    migrate(db);
    return db;
  }

  private exists(p: string): boolean {
    return fs.existsSync(p);
  }

  private rm(p: string): void {
    fs.unlinkSync(p);
  }

  onModuleDestroy(): void {
    try {
      this._db.close();
    } catch (err) {
      this.logger.warn(`closing DB on app destroy: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
