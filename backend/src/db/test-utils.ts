import Database from 'better-sqlite3';
import { migrate } from './migrate';

/**
 * Create an in-memory SQLite database with all migrations applied.
 *
 * Used by Repository tests — faster and more reliable than mocking
 * the native better-sqlite3 module. WAL pragma is a no-op on :memory:
 * but kept for config parity with production.
 */
export function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}
