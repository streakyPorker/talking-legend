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

@Injectable()
export class SaveRepository {
  private readonly upsertStmt: Database.Statement;
  private readonly findBySlotStmt: Database.Statement<[number]>;
  private readonly findAllStmt: Database.Statement<[]>;
  private readonly deleteStmt: Database.Statement<[number]>;

  constructor(@Inject(DB_INSTANCE) private readonly db: Database.Database) {
    this.upsertStmt = db.prepare(`
      INSERT INTO saves (slot, player_name, turn, region, world, game_id, saved_at)
      VALUES (@slot, @player_name, @turn, @region, @world, @game_id, datetime('now'))
      ON CONFLICT(slot) DO UPDATE SET
        player_name = excluded.player_name,
        turn        = excluded.turn,
        region      = excluded.region,
        world       = excluded.world,
        game_id     = excluded.game_id,
        saved_at    = datetime('now')
    `);
    this.findBySlotStmt = db.prepare('SELECT * FROM saves WHERE slot = ?');
    this.findAllStmt = db.prepare('SELECT * FROM saves ORDER BY slot ASC');
    this.deleteStmt = db.prepare('DELETE FROM saves WHERE slot = ?');
  }

  upsert(slot: number, data: { playerName: string; turn: number; region: string; world: string; gameId: string }): void {
    this.upsertStmt.run({
      slot,
      player_name: data.playerName,
      turn: data.turn,
      region: data.region,
      world: data.world,
      game_id: data.gameId,
    });
  }

  findBySlot(slot: number): SaveRecord | undefined {
    const row = this.findBySlotStmt.get(slot) as
      | { slot: number; player_name: string; turn: number; region: string; world: string; game_id: string; saved_at: string }
      | undefined;
    return row ? rowToRecord(row) : undefined;
  }

  findAll(): SaveRecord[] {
    const rows = this.findAllStmt.all() as Array<{
      slot: number; player_name: string; turn: number; region: string; world: string; game_id: string; saved_at: string;
    }>;
    return rows.map(rowToRecord);
  }

  delete(slot: number): void {
    this.deleteStmt.run(slot);
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
