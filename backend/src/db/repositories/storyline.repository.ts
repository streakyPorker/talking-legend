import { Injectable, Inject } from '@nestjs/common';
import type Database from 'better-sqlite3';
import { DB_INSTANCE } from '../tokens';
import type { StorylineRow } from '../rows';

/**
 * Storyline domain state — not yet in shared types; defined here until
 * RFC-009 promotes it.
 */
export interface StorylineState {
  currentStage: string;
  stageData: Record<string, unknown>;
  completedStages: string[];
  activeEvents: string[];
}

/**
 * Repository for the `storylines` table.
 *
 * JSON columns (stage_data, completed_stages, active_events) are
 * serialized/deserialized in private helpers.
 */
@Injectable()
export class StorylineRepository {
  private readonly findStmt: Database.Statement<[string]>;
  private readonly upsertStmt: Database.Statement;
  private readonly deleteStmt: Database.Statement<[string]>;

  constructor(@Inject(DB_INSTANCE) private readonly db: Database.Database) {
    this.findStmt = db.prepare('SELECT * FROM storylines WHERE game_id = ?');
    this.upsertStmt = db.prepare(`
      INSERT INTO storylines (game_id, current_stage, stage_data, completed_stages, active_events)
      VALUES (@game_id, @current_stage, @stage_data, @completed_stages, @active_events)
      ON CONFLICT(game_id) DO UPDATE SET
        current_stage    = excluded.current_stage,
        stage_data       = excluded.stage_data,
        completed_stages = excluded.completed_stages,
        active_events    = excluded.active_events,
        updated_at       = datetime('now')
    `);
    this.deleteStmt = db.prepare('DELETE FROM storylines WHERE game_id = ?');
  }

  findByGameId(gameId: string): StorylineState | undefined {
    const row = this.findStmt.get(gameId) as StorylineRow | undefined;
    return row ? deserializeStoryline(row) : undefined;
  }

  upsert(gameId: string, state: StorylineState): void {
    this.upsertStmt.run(serializeStoryline(gameId, state));
  }

  delete(gameId: string): void {
    this.deleteStmt.run(gameId);
  }
}

// ── Serialization ────────────────────────────────────────

function serializeStoryline(gameId: string, s: StorylineState): Record<string, unknown> {
  return {
    game_id: gameId,
    current_stage: s.currentStage,
    stage_data: JSON.stringify(s.stageData),
    completed_stages: JSON.stringify(s.completedStages),
    active_events: JSON.stringify(s.activeEvents),
  };
}

function deserializeStoryline(row: StorylineRow): StorylineState {
  return {
    currentStage: row.current_stage,
    stageData: JSON.parse(row.stage_data) as Record<string, unknown>,
    completedStages: JSON.parse(row.completed_stages) as string[],
    activeEvents: JSON.parse(row.active_events) as string[],
  };
}
