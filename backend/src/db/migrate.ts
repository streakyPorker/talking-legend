import Database from 'better-sqlite3';

export interface Migration {
  version: number;
  name: string;
  up(db: Database.Database): void;
}

/**
 * All DDL is kept in a single versioned array.
 * Each migration wraps DDL in BEGIN IMMEDIATE / COMMIT so that
 * a partial failure rolls back cleanly.
 *
 * @see RFC-002 "Migration 生命周期" section for the lifecycle contract.
 */
const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    up(db: Database.Database) {
      db.exec(`
        BEGIN IMMEDIATE;

        -- 1. games — game session master table
        CREATE TABLE IF NOT EXISTS games (
          id          TEXT PRIMARY KEY,
          player_name TEXT NOT NULL,
          turn        INTEGER NOT NULL DEFAULT 0,
          phase       TEXT NOT NULL DEFAULT 'intro',
          created_at  TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- 2. worlds — world state (1:1 games)
        CREATE TABLE IF NOT EXISTS worlds (
          game_id         TEXT PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
          name            TEXT NOT NULL,
          description     TEXT NOT NULL,
          current_region  TEXT NOT NULL,
          time_of_day     TEXT NOT NULL DEFAULT 'morning',
          weather         TEXT NOT NULL DEFAULT 'clear',
          regions         TEXT NOT NULL,
          global_events   TEXT NOT NULL DEFAULT '[]',
          created_at      TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- 3. npcs — NPC state (1:N games)
        CREATE TABLE IF NOT EXISTS npcs (
          id               TEXT PRIMARY KEY,
          game_id          TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
          name             TEXT NOT NULL,
          role             TEXT NOT NULL,
          personality      TEXT NOT NULL,
          current_mood     TEXT NOT NULL DEFAULT 'neutral',
          location         TEXT NOT NULL,
          is_alive         INTEGER NOT NULL DEFAULT 1,
          created_at       TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_npcs_game_id ON npcs(game_id);

        -- 4. npc_memories — NPC memory entries (1:N npcs)
        CREATE TABLE IF NOT EXISTS npc_memories (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          npc_id     TEXT NOT NULL REFERENCES npcs(id) ON DELETE CASCADE,
          content    TEXT NOT NULL,
          turn       INTEGER NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_npc_memories_npc_id ON npc_memories(npc_id);

        -- 5. players — player state (1:1 games)
        CREATE TABLE IF NOT EXISTS players (
          game_id     TEXT PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
          name        TEXT NOT NULL,
          location    TEXT NOT NULL,
          inventory   TEXT NOT NULL DEFAULT '[]',
          reputation  TEXT NOT NULL DEFAULT '{}',
          created_at  TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- 6. player_quests — player quests (1:N players)
        CREATE TABLE IF NOT EXISTS player_quests (
          id          TEXT PRIMARY KEY,
          game_id     TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
          title       TEXT NOT NULL,
          description TEXT NOT NULL,
          status      TEXT NOT NULL DEFAULT 'active',
          progress    INTEGER NOT NULL DEFAULT 0,
          created_at  TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_player_quests_game_id ON player_quests(game_id);

        -- 7. storylines — storyline state (1:1 games)
        CREATE TABLE IF NOT EXISTS storylines (
          game_id          TEXT PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
          current_stage    TEXT NOT NULL,
          stage_data       TEXT NOT NULL DEFAULT '{}',
          completed_stages TEXT NOT NULL DEFAULT '[]',
          active_events    TEXT NOT NULL DEFAULT '[]',
          created_at       TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- 8. llm_logs — LLM call audit log (1:N games)
        CREATE TABLE IF NOT EXISTS llm_logs (
          id                INTEGER PRIMARY KEY AUTOINCREMENT,
          game_id           TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
          call_type         TEXT NOT NULL,
          model             TEXT NOT NULL,
          prompt_tokens      INTEGER NOT NULL,
          completion_tokens  INTEGER NOT NULL,
          latency_ms        INTEGER NOT NULL,
          cost_usd          REAL NOT NULL,
          created_at        TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_llm_logs_game_id ON llm_logs(game_id);
        CREATE INDEX IF NOT EXISTS idx_llm_logs_call_type ON llm_logs(call_type);
        CREATE INDEX IF NOT EXISTS idx_llm_logs_created_at ON llm_logs(created_at);
        CREATE INDEX IF NOT EXISTS idx_llm_logs_game_type ON llm_logs(game_id, call_type);

        INSERT INTO _schema_version (version) VALUES (1);
        COMMIT;
      `);
    },
  },
];

/**
 * Run pending migrations against `db` in order.
 * The _schema_version table stores already-applied versions; only unapplied
 * migrations execute. If any migration fails the service will refuse to start.
 */
export function migrate(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS _schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  const row = db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM _schema_version').get() as { v: number };
  const currentVersion = row.v;

  for (const m of migrations) {
    if (m.version > currentVersion) {
      try {
        m.up(db);
        console.log(`[migrate] v${m.version} (${m.name}) applied.`);
      } catch (err) {
        console.error(`[migrate] v${m.version} (${m.name}) FAILED:`, err);
        // Schema version is NOT incremented on failure — retry on next startup.
        throw err;
      }
    }
  }
}
