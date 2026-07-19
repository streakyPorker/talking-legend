import { Injectable, Inject } from '@nestjs/common';
import type Database from 'better-sqlite3';
import type { WorldState, Region } from '@talking-legend/shared';
import { DB_INSTANCE } from '../tokens';
import type { WorldRow } from '../rows';

/**
 * Repository for the `worlds` table.
 *
 * JSON columns (regions, global_events) are serialized/deserialized
 * in private helpers. Public methods work with WorldState domain types.
 */
@Injectable()
export class WorldRepository {
  private readonly findStmt: Database.Statement<[string]>;
  private readonly upsertStmt: Database.Statement;
  private readonly deleteStmt: Database.Statement<[string]>;

  constructor(@Inject(DB_INSTANCE) private readonly db: Database.Database) {
    this.findStmt = db.prepare('SELECT * FROM worlds WHERE game_id = ?');
    this.upsertStmt = db.prepare(`
      INSERT INTO worlds (game_id, name, description, current_region, time_of_day, weather, regions, global_events)
      VALUES (@game_id, @name, @description, @current_region, @time_of_day, @weather, @regions, @global_events)
      ON CONFLICT(game_id) DO UPDATE SET
        name            = excluded.name,
        description     = excluded.description,
        current_region  = excluded.current_region,
        time_of_day     = excluded.time_of_day,
        weather         = excluded.weather,
        regions         = excluded.regions,
        global_events   = excluded.global_events,
        updated_at      = datetime('now')
    `);
    this.deleteStmt = db.prepare('DELETE FROM worlds WHERE game_id = ?');
  }

  findByGameId(gameId: string): WorldState | undefined {
    const row = this.findStmt.get(gameId) as WorldRow | undefined;
    return row ? deserializeWorld(row) : undefined;
  }

  upsert(gameId: string, world: WorldState): void {
    this.upsertStmt.run(serializeWorld(gameId, world));
  }

  delete(gameId: string): void {
    this.deleteStmt.run(gameId);
  }
}

// ── Serialization ────────────────────────────────────────

function serializeWorld(gameId: string, w: WorldState): Record<string, unknown> {
  return {
    game_id: gameId,
    name: w.name,
    description: w.description,
    current_region: w.currentRegion,
    time_of_day: w.timeOfDay,
    weather: w.weather,
    regions: JSON.stringify(w.regions),
    global_events: JSON.stringify(w.globalEvents),
  };
}

function deserializeWorld(row: WorldRow): WorldState {
  const regions: Region[] = JSON.parse(row.regions).map(
    (r: Region) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      connectedRegions: r.connectedRegions ?? [],
      // Future fields added here with ?? defaults:
      // climate: r.climate ?? 'temperate',
    }),
  );

  return {
    name: row.name,
    description: row.description,
    currentRegion: row.current_region,
    timeOfDay: row.time_of_day,
    weather: row.weather,
    regions,
    globalEvents: JSON.parse(row.global_events),
  };
}
