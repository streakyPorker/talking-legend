import Database from 'better-sqlite3';

/**
 * Create all tables if they don't exist.
 * No versioning — always safe with IF NOT EXISTS.
 */
export function migrate(db: Database.Database): void {
  db.exec(`
    -- 1. games
    CREATE TABLE IF NOT EXISTS games (
      id          TEXT PRIMARY KEY,
      player_name TEXT NOT NULL,
      turn        INTEGER NOT NULL DEFAULT 0,
      phase       TEXT NOT NULL DEFAULT 'intro',
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 2. worlds
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

    -- 3. npcs
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

    -- 4. npc_memories
    CREATE TABLE IF NOT EXISTS npc_memories (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      npc_id     TEXT NOT NULL REFERENCES npcs(id) ON DELETE CASCADE,
      content    TEXT NOT NULL,
      turn       INTEGER NOT NULL,
      importance INTEGER NOT NULL DEFAULT 1,
      type       TEXT NOT NULL DEFAULT 'dialogue',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_npc_memories_npc_id ON npc_memories(npc_id);

    -- 5. players
    CREATE TABLE IF NOT EXISTS players (
      game_id     TEXT PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      location    TEXT NOT NULL,
      inventory   TEXT NOT NULL DEFAULT '[]',
      reputation  TEXT NOT NULL DEFAULT '{}',
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 6. player_quests
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

    -- 7. storylines
    CREATE TABLE IF NOT EXISTS storylines (
      game_id          TEXT PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
      current_stage    TEXT NOT NULL,
      stage_data       TEXT NOT NULL DEFAULT '{}',
      completed_stages TEXT NOT NULL DEFAULT '[]',
      active_events    TEXT NOT NULL DEFAULT '[]',
      created_at       TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 8. llm_logs
    CREATE TABLE IF NOT EXISTS llm_logs (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id           TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      call_type         TEXT NOT NULL,
      model             TEXT NOT NULL,
      prompt_tokens     INTEGER NOT NULL,
      completion_tokens INTEGER NOT NULL,
      latency_ms        INTEGER NOT NULL,
      cost_usd          REAL NOT NULL,
      created_at        TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_llm_logs_game_id ON llm_logs(game_id);
    CREATE INDEX IF NOT EXISTS idx_llm_logs_call_type ON llm_logs(call_type);
    CREATE INDEX IF NOT EXISTS idx_llm_logs_created_at ON llm_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_llm_logs_game_type ON llm_logs(game_id, call_type);

    -- 9. travel_log
    CREATE TABLE IF NOT EXISTS travel_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id TEXT NOT NULL,
      from_region TEXT NOT NULL,
      to_region TEXT NOT NULL,
      turn INTEGER NOT NULL,
      trigger TEXT NOT NULL DEFAULT 'click',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_travel_log_game ON travel_log(game_id);

    -- 10. saves
    CREATE TABLE IF NOT EXISTS saves (
      slot        INTEGER PRIMARY KEY,
      player_name TEXT NOT NULL,
      turn        INTEGER NOT NULL,
      region      TEXT NOT NULL,
      world       TEXT NOT NULL,
      game_id     TEXT NOT NULL DEFAULT '',
      saved_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 11. game_events
    CREATE TABLE IF NOT EXISTS game_events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id     TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      type        TEXT NOT NULL,
      location    TEXT NOT NULL,
      actors      TEXT NOT NULL DEFAULT '[]',
      summary     TEXT NOT NULL,
      importance  INTEGER NOT NULL DEFAULT 1,
      turn        INTEGER NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_game_events_game ON game_events(game_id);
    CREATE INDEX IF NOT EXISTS idx_game_events_location ON game_events(location);
  `);

  console.log('[migrate] schema ensured');
}
