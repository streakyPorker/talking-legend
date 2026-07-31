import { Injectable, Inject } from '@nestjs/common';
import type Database from 'better-sqlite3';
import { DB_INSTANCE } from '../tokens';

export interface SaveRecord {
  slot: number;
  playerName: string;
  turn: number;
  region: string;
  world: string;
  gameId: string;
  savedAt: string;
}

/**
 * Repository for the `saves` table.
 *
 * Statements are prepared lazily at call time so they survive a
 * DbConnectionManager.reset() connection swap.
 */
@Injectable()
export class SaveRepository {
  constructor(@Inject(DB_INSTANCE) private readonly db: Database.Database) {}

  upsert(slot: number, data: { playerName: string; turn: number; region: string; world: string; gameId: string }): void {
    this.db
      .prepare(`
        INSERT INTO saves (slot, player_name, turn, region, world, game_id, saved_at)
        VALUES (@slot, @player_name, @turn, @region, @world, @game_id, datetime('now'))
        ON CONFLICT(slot) DO UPDATE SET
          player_name = excluded.player_name,
          turn        = excluded.turn,
          region      = excluded.region,
          world       = excluded.world,
          game_id     = excluded.game_id,
          saved_at    = datetime('now')
      `)
      .run({
        slot,
        player_name: data.playerName,
        turn: data.turn,
        region: data.region,
        world: data.world,
        game_id: data.gameId,
      });
  }

  findBySlot(slot: number): SaveRecord | undefined {
    const row = this.db
      .prepare('SELECT * FROM saves WHERE slot = ?')
      .get(slot) as
      | { slot: number; player_name: string; turn: number; region: string; world: string; game_id: string; saved_at: string }
      | undefined;
    return row ? rowToRecord(row) : undefined;
  }

  findAll(): SaveRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM saves ORDER BY slot ASC')
      .all() as Array<{
        slot: number; player_name: string; turn: number; region: string; world: string; game_id: string; saved_at: string;
      }>;
    return rows.map(rowToRecord);
  }

  delete(slot: number): void {
    this.db.prepare('DELETE FROM saves WHERE slot = ?').run(slot);
  }
}

function rowToRecord(row: {
  slot: number; player_name: string; turn: number; region: string; world: string; game_id: string; saved_at: string;
}): SaveRecord {
  return {
    slot: row.slot,
    playerName: row.player_name,
    turn: row.turn,
    region: row.region,
    world: row.world,
    gameId: row.game_id || '',
    savedAt: row.saved_at,
  };
}
