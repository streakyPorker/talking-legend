import { Injectable, Inject } from '@nestjs/common';
import type Database from 'better-sqlite3';
import type { GameState, GamePhase } from '@talking-legend/shared';
import { DB_INSTANCE } from '../db.module';
import type { GameRow } from '../rows';

/**
 * Repository for the `games` table.
 *
 * Public methods use Domain types (GameState). Private helpers handle
 * Row↔Domain mapping. Only games-table fields are populated — nested
 * objects (world, npcs, player) come from their respective repositories.
 */
@Injectable()
export class GameRepository {
  private readonly findStmt: Database.Statement<[string]>;
  private readonly insertStmt: Database.Statement<[string, string, number, string]>;
  private readonly updateStmt: Database.Statement<[number, string, string]>;
  private readonly deleteStmt: Database.Statement<[string]>;
  private readonly listStmt: Database.Statement<[]>;

  constructor(@Inject(DB_INSTANCE) private readonly db: Database.Database) {
    this.findStmt = db.prepare('SELECT * FROM games WHERE id = ?');
    this.insertStmt = db.prepare(
      'INSERT INTO games (id, player_name, turn, phase) VALUES (?, ?, ?, ?)',
    );
    this.updateStmt = db.prepare(
      'UPDATE games SET turn = ?, phase = ?, updated_at = datetime(\'now\') WHERE id = ?',
    );
    this.deleteStmt = db.prepare('DELETE FROM games WHERE id = ?');
    this.listStmt = db.prepare('SELECT * FROM games ORDER BY created_at DESC');
  }

  findById(id: string): GameState | undefined {
    const row = this.findStmt.get(id) as GameRow | undefined;
    return row ? rowToDomain(row) : undefined;
  }

  create(id: string, playerName: string): GameState {
    this.insertStmt.run(id, playerName, 0, 'intro');
    return this.findById(id)!;
  }

  /**
   * Optimistic-concurrency update: only succeeds if turn matches expected value.
   * Returns true if updated, false if another request already incremented turn.
   */
  updateTurn(id: string, turn: number, expectedTurn: number): boolean {
    const stmt = this.db.prepare(
      'UPDATE games SET turn = ?, phase = ?, updated_at = datetime(\'now\') WHERE id = ? AND turn = ?',
    );
    const result = stmt.run(turn, 'exploration', id, expectedTurn);
    return result.changes > 0;
  }

  updatePhase(id: string, phase: GamePhase): void {
    this.db
      .prepare('UPDATE games SET phase = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(phase, id);
  }

  delete(id: string): void {
    this.deleteStmt.run(id);
  }

  list(): GameState[] {
    const rows = this.listStmt.all() as GameRow[];
    return rows.map(rowToDomain);
  }
}

// ── Row ↔ Domain mapping ─────────────────────────────────

function rowToDomain(row: GameRow): GameState {
  return {
    id: row.id,
    player: {
      name: row.player_name,
      location: '',
      inventory: [],
      reputation: {},
      quests: [],
    },
    world: {
      name: '',
      description: '',
      regions: [],
      currentRegion: '',
      timeOfDay: '',
      weather: '',
      globalEvents: [],
    },
    npcs: [],
    turn: row.turn,
    phase: row.phase as GamePhase,
  };
}
