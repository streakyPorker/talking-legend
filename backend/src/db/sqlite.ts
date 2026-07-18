import path from 'path';
import fs from 'fs';

/**
 * Placeholder: wraps better-sqlite3 in RFC-002.
 * Currently the DB module uses an in-memory Map skeleton.
 */
export function createDb(_dbPath: string): any {
  const dir = path.dirname(_dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  // TODO RFC-002: replace with new (require('better-sqlite3'))(dbPath)
  throw new Error('better-sqlite3 not installed — will be set up in RFC-002');
}
