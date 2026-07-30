/**
 * RFC-011: Repository for the `game_events` table.
 *
 * Stores narrative events (NPC dialogue summaries, world events, etc.)
 * scoped to a game. Used for context building and event history.
 */

import { Injectable, Inject } from '@nestjs/common';
import type Database from 'better-sqlite3';
import { DB_INSTANCE } from '../tokens';
import type { GameEventRow } from '../rows';

export interface GameEventEntry {
  id: number;
  gameId: string;
  type: string;
  location: string;
  actors: string[];
  summary: string;
  importance: number;
  turn: number;
  createdAt: string;
}

@Injectable()
export class GameEventsRepository {
  private readonly insertStmt: Database.Statement;
  private readonly findByGameStmt: Database.Statement<[string]>;
  private readonly findRecentByGameStmt: Database.Statement;
  private readonly findByLocationStmt: Database.Statement;

  constructor(@Inject(DB_INSTANCE) private readonly db: Database.Database) {
    this.insertStmt = db.prepare(`
      INSERT INTO game_events (game_id, type, location, actors, summary, importance, turn)
      VALUES (@game_id, @type, @location, @actors, @summary, @importance, @turn)
    `);
    this.findByGameStmt = db.prepare(
      'SELECT * FROM game_events WHERE game_id = ? ORDER BY turn ASC',
    );
    this.findRecentByGameStmt = db.prepare(
      'SELECT * FROM game_events WHERE game_id = ? ORDER BY id DESC LIMIT ?',
    );
    this.findByLocationStmt = db.prepare(
      'SELECT * FROM game_events WHERE game_id = ? AND location = ? ORDER BY id DESC LIMIT ?',
    );
  }

  insert(event: Omit<GameEventEntry, 'id' | 'createdAt'>): number {
    const result = this.insertStmt.run({
      game_id: event.gameId,
      type: event.type,
      location: event.location,
      actors: JSON.stringify(event.actors),
      summary: event.summary,
      importance: event.importance,
      turn: event.turn,
    });
    return Number(result.lastInsertRowid);
  }

  findByGameId(gameId: string): GameEventEntry[] {
    const rows = this.findByGameStmt.all(gameId) as GameEventRow[];
    return rows.map(rowToEntry);
  }

  findRecentByGameId(gameId: string, limit = 10): GameEventEntry[] {
    const rows = this.findRecentByGameStmt.all(gameId, limit) as GameEventRow[];
    return rows.map(rowToEntry);
  }

  findByLocation(gameId: string, location: string, limit = 5): GameEventEntry[] {
    const rows = this.findByLocationStmt.all(gameId, location, limit) as GameEventRow[];
    return rows.map(rowToEntry);
  }
}

function rowToEntry(row: GameEventRow): GameEventEntry {
  return {
    id: row.id,
    gameId: row.game_id,
    type: row.type,
    location: row.location,
    actors: JSON.parse(row.actors) as string[],
    summary: row.summary,
    importance: row.importance,
    turn: row.turn,
    createdAt: row.created_at,
  };
}
