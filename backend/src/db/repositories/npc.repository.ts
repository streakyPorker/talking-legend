import { Injectable, Inject } from '@nestjs/common';
import type Database from 'better-sqlite3';
import type { NPCState } from '@talking-legend/shared';
import { DB_INSTANCE } from '../db.module';
import type { NpcRow, NpcMemoryRow } from '../rows';

/**
 * Repository for the `npcs` table + associated `npc_memories` table.
 *
 * NPCState.memoryOfPlayer is stored in the normalized npc_memories table
 * and loaded eagerly when querying NPCs.
 */
@Injectable()
export class NpcRepository {
  private readonly findByGameStmt: Database.Statement<[string]>;
  private readonly findByIdStmt: Database.Statement<[string]>;
  private readonly insertStmt: Database.Statement;
  private readonly updateStmt: Database.Statement;
  private readonly deleteStmt: Database.Statement<[string]>;
  private readonly deleteByGameStmt: Database.Statement<[string]>;
  private readonly memoriesStmt: Database.Statement<[string]>;
  private readonly insertMemoryStmt: Database.Statement;
  private readonly deleteMemoriesStmt: Database.Statement<[string]>;

  constructor(@Inject(DB_INSTANCE) private readonly db: Database.Database) {
    this.findByGameStmt = db.prepare('SELECT * FROM npcs WHERE game_id = ? ORDER BY created_at ASC');
    this.findByIdStmt = db.prepare('SELECT * FROM npcs WHERE id = ?');
    this.insertStmt = db.prepare(`
      INSERT INTO npcs (id, game_id, name, role, personality, current_mood, location, is_alive)
      VALUES (@id, @game_id, @name, @role, @personality, @current_mood, @location, @is_alive)
    `);
    this.updateStmt = db.prepare(`
      UPDATE npcs SET
        current_mood = COALESCE(@current_mood, current_mood),
        location     = COALESCE(@location, location),
        is_alive     = COALESCE(@is_alive, is_alive),
        updated_at   = datetime('now')
      WHERE id = @id
    `);
    this.deleteStmt = db.prepare('DELETE FROM npcs WHERE id = ?');
    this.deleteByGameStmt = db.prepare('DELETE FROM npcs WHERE game_id = ?');
    this.memoriesStmt = db.prepare('SELECT content FROM npc_memories WHERE npc_id = ? ORDER BY turn ASC');
    this.insertMemoryStmt = db.prepare(
      'INSERT INTO npc_memories (npc_id, content, turn) VALUES (@npc_id, @content, @turn)',
    );
    this.deleteMemoriesStmt = db.prepare('DELETE FROM npc_memories WHERE npc_id = ?');
  }

  findByGameId(gameId: string): NPCState[] {
    const rows = this.findByGameStmt.all(gameId) as NpcRow[];
    return rows.map((r) => this.rowToDomain(r));
  }

  findById(id: string): NPCState | undefined {
    const row = this.findByIdStmt.get(id) as NpcRow | undefined;
    return row ? this.rowToDomain(row) : undefined;
  }

  create(gameId: string, npc: NPCState): void {
    this.insertStmt.run({
      id: npc.id,
      game_id: gameId,
      name: npc.name,
      role: npc.role,
      personality: npc.personality,
      current_mood: npc.currentMood,
      location: npc.location,
      is_alive: npc.isAlive ? 1 : 0,
    });
    // Insert initial memories if any
    for (const memory of npc.memoryOfPlayer) {
      this.insertMemoryStmt.run({ npc_id: npc.id, content: memory, turn: 0 });
    }
  }

  update(id: string, patch: Partial<NPCState>): void {
    this.updateStmt.run({
      id,
      current_mood: patch.currentMood ?? null,
      location: patch.location ?? null,
      is_alive: patch.isAlive !== undefined ? (patch.isAlive ? 1 : 0) : null,
    });
  }

  delete(id: string): void {
    this.deleteMemoriesStmt.run(id);
    this.deleteStmt.run(id);
  }

  deleteByGameId(gameId: string): void {
    // CASCADE handles npc_memories
    this.deleteByGameStmt.run(gameId);
  }

  // ── Memory management ──────────────────────────────────

  getMemories(npcId: string): string[] {
    const rows = this.memoriesStmt.all(npcId) as Pick<NpcMemoryRow, 'content'>[];
    return rows.map((r) => r.content);
  }

  addMemory(npcId: string, content: string, turn: number): void {
    this.insertMemoryStmt.run({ npc_id: npcId, content, turn });
  }

  // ── Private mapping ────────────────────────────────────

  private rowToDomain(row: NpcRow): NPCState {
    const memories = this.getMemories(row.id);
    return {
      id: row.id,
      name: row.name,
      role: row.role,
      personality: row.personality,
      currentMood: row.current_mood,
      location: row.location,
      memoryOfPlayer: memories,
      isAlive: row.is_alive === 1,
    };
  }
}
