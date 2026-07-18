import { Injectable, Inject } from '@nestjs/common';
import type Database from 'better-sqlite3';
import type { PlayerState, Quest } from '@talking-legend/shared';
import { DB_INSTANCE } from '../db.module';
import type { PlayerRow, PlayerQuestRow } from '../rows';

/**
 * Repository for the `players` table + associated `player_quests` table.
 *
 * JSON columns (inventory, reputation) are serialized/deserialized in
 * private helpers. Quests are stored in a separate table and loaded
 * eagerly when fetching player state.
 */
@Injectable()
export class PlayerRepository {
  private readonly findStmt: Database.Statement<[string]>;
  private readonly upsertStmt: Database.Statement;
  private readonly deleteStmt: Database.Statement<[string]>;
  private readonly questByGameStmt: Database.Statement<[string]>;
  private readonly insertQuestStmt: Database.Statement;
  private readonly updateQuestStmt: Database.Statement;
  private readonly deleteQuestsStmt: Database.Statement<[string]>;

  constructor(@Inject(DB_INSTANCE) private readonly db: Database.Database) {
    this.findStmt = db.prepare('SELECT * FROM players WHERE game_id = ?');
    this.upsertStmt = db.prepare(`
      INSERT INTO players (game_id, name, location, inventory, reputation)
      VALUES (@game_id, @name, @location, @inventory, @reputation)
      ON CONFLICT(game_id) DO UPDATE SET
        name        = excluded.name,
        location    = excluded.location,
        inventory   = excluded.inventory,
        reputation  = excluded.reputation,
        updated_at  = datetime('now')
    `);
    this.deleteStmt = db.prepare('DELETE FROM players WHERE game_id = ?');
    this.questByGameStmt = db.prepare(
      'SELECT * FROM player_quests WHERE game_id = ? ORDER BY created_at ASC',
    );
    this.insertQuestStmt = db.prepare(`
      INSERT INTO player_quests (id, game_id, title, description, status, progress)
      VALUES (@id, @game_id, @title, @description, @status, @progress)
    `);
    this.updateQuestStmt = db.prepare(`
      UPDATE player_quests SET
        status      = COALESCE(@status, status),
        progress    = COALESCE(@progress, progress),
        updated_at  = datetime('now')
      WHERE id = @id
    `);
    this.deleteQuestsStmt = db.prepare('DELETE FROM player_quests WHERE game_id = ?');
  }

  findByGameId(gameId: string): PlayerState | undefined {
    const row = this.findStmt.get(gameId) as PlayerRow | undefined;
    return row ? this.deserializePlayer(row) : undefined;
  }

  upsert(gameId: string, player: PlayerState): void {
    const quests = player.quests;

    this.upsertStmt.run({
      game_id: gameId,
      name: player.name,
      location: player.location,
      inventory: JSON.stringify(player.inventory),
      reputation: JSON.stringify(player.reputation),
    });

    // Write-through quests
    this.deleteQuestsStmt.run(gameId);
    for (const q of quests) {
      this.insertQuestStmt.run({
        id: q.id,
        game_id: gameId,
        title: q.title,
        description: q.description,
        status: q.status,
        progress: q.progress,
      });
    }
  }

  delete(gameId: string): void {
    this.deleteStmt.run(gameId);
  }

  // ── Quest management ───────────────────────────────────

  getQuests(gameId: string): Quest[] {
    const rows = this.questByGameStmt.all(gameId) as PlayerQuestRow[];
    return rows.map(questRowToDomain);
  }

  addQuest(gameId: string, quest: Quest): void {
    this.insertQuestStmt.run({
      id: quest.id,
      game_id: gameId,
      title: quest.title,
      description: quest.description,
      status: quest.status,
      progress: quest.progress,
    });
  }

  updateQuest(questId: string, patch: Partial<Quest>): void {
    this.updateQuestStmt.run({
      id: questId,
      status: patch.status ?? null,
      progress: patch.progress ?? null,
    });
  }

  // ── Private mapping ────────────────────────────────────

  private deserializePlayer(row: PlayerRow): PlayerState {
    const quests = this.getQuests(row.game_id);
    return {
      name: row.name,
      location: row.location,
      inventory: JSON.parse(row.inventory),
      reputation: JSON.parse(row.reputation),
      quests,
    };
  }
}

function questRowToDomain(row: PlayerQuestRow): Quest {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status as Quest['status'],
    progress: row.progress,
  };
}
