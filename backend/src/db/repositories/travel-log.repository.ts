import { Injectable, Inject } from '@nestjs/common';
import type Database from 'better-sqlite3';
import { DB_INSTANCE } from '../tokens';

export interface TravelLogEntry {
  id: number;
  gameId: string;
  fromRegion: string;
  toRegion: string;
  turn: number;
  trigger: 'click' | 'dialogue';
  createdAt: string;
}

@Injectable()
export class TravelLogRepository {
  private readonly insertStmt: Database.Statement;
  private readonly findByGameStmt: Database.Statement<[string]>;
  private readonly recentByGameStmt: Database.Statement;

  constructor(@Inject(DB_INSTANCE) private readonly db: Database.Database) {
    this.insertStmt = db.prepare(`
      INSERT INTO travel_log (game_id, from_region, to_region, turn, trigger)
      VALUES (@game_id, @from_region, @to_region, @turn, @trigger)
    `);
    this.findByGameStmt = db.prepare(
      'SELECT * FROM travel_log WHERE game_id = ? ORDER BY created_at ASC',
    );
    this.recentByGameStmt = db.prepare(
      'SELECT * FROM travel_log WHERE game_id = ? ORDER BY id DESC LIMIT ?',
    );
  }

  insert(entry: { gameId: string; fromRegion: string; toRegion: string; turn: number; trigger: 'click' | 'dialogue' }): number {
    const result = this.insertStmt.run({
      game_id: entry.gameId,
      from_region: entry.fromRegion,
      to_region: entry.toRegion,
      turn: entry.turn,
      trigger: entry.trigger,
    });
    return Number(result.lastInsertRowid);
  }

  findByGameId(gameId: string): TravelLogEntry[] {
    const rows = this.findByGameStmt.all(gameId) as Array<{
      id: number; game_id: string; from_region: string; to_region: string;
      turn: number; trigger: 'click' | 'dialogue'; created_at: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      gameId: r.game_id,
      fromRegion: r.from_region,
      toRegion: r.to_region,
      turn: r.turn,
      trigger: r.trigger,
      createdAt: r.created_at,
    }));
  }

  getRecent(gameId: string, limit = 5): TravelLogEntry[] {
    const rows = this.recentByGameStmt.all(gameId, limit) as Array<{
      id: number; game_id: string; from_region: string; to_region: string;
      turn: number; trigger: 'click' | 'dialogue'; created_at: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      gameId: r.game_id,
      fromRegion: r.from_region,
      toRegion: r.to_region,
      turn: r.turn,
      trigger: r.trigger,
      createdAt: r.created_at,
    }));
  }
}
