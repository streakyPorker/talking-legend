import { Injectable, Inject } from '@nestjs/common';
import type Database from 'better-sqlite3';
import { DB_INSTANCE } from '../tokens';
import type { LlmLogRow } from '../rows';

/**
 * LLM call log entry — used for audit trail and cost tracking.
 */
export interface LlmLogEntry {
  id: number;
  gameId: string;
  callType: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  costUsd: number;
  createdAt: string;
}

/**
 * Aggregated cost breakdown by call type.
 */
export interface CostBreakdown {
  callType: string;
  totalCostUsd: number;
  totalCalls: number;
}

/**
 * Repository for the `llm_logs` table.
 *
 * In addition to standard CRUD, provides aggregate queries for cost
 * tracking and usage analytics.
 */
@Injectable()
export class LlmLogRepository {
  private readonly insertStmt: Database.Statement;
  private readonly findByGameStmt: Database.Statement<[string]>;
  private readonly findByIdStmt: Database.Statement<[number]>;
  private readonly costByGameStmt: Database.Statement<[string]>;
  private readonly costByGameAndTypeStmt: Database.Statement;
  private readonly recentByGameStmt: Database.Statement;
  private readonly totalCostStmt: Database.Statement<[string]>;

  constructor(@Inject(DB_INSTANCE) private readonly db: Database.Database) {
    this.insertStmt = db.prepare(`
      INSERT INTO llm_logs (game_id, call_type, model, prompt_tokens, completion_tokens, latency_ms, cost_usd)
      VALUES (@game_id, @call_type, @model, @prompt_tokens, @completion_tokens, @latency_ms, @cost_usd)
    `);
    this.findByGameStmt = db.prepare(
      'SELECT * FROM llm_logs WHERE game_id = ? ORDER BY created_at ASC',
    );
    this.findByIdStmt = db.prepare('SELECT * FROM llm_logs WHERE id = ?');
    this.costByGameStmt = db.prepare(`
      SELECT SUM(cost_usd) AS total_cost, SUM(prompt_tokens + completion_tokens) AS total_tokens
      FROM llm_logs WHERE game_id = ?
    `);
    this.costByGameAndTypeStmt = db.prepare(`
      SELECT call_type, SUM(cost_usd) AS total_cost_usd, COUNT(*) AS total_calls
      FROM llm_logs
      WHERE game_id = ?
      GROUP BY call_type
    `);
    this.recentByGameStmt = db.prepare(
      'SELECT * FROM llm_logs WHERE game_id = ? ORDER BY id DESC LIMIT ?',
    );
    this.totalCostStmt = db.prepare('SELECT SUM(cost_usd) AS total FROM llm_logs WHERE game_id = ?');
  }

  insert(entry: Omit<LlmLogEntry, 'id' | 'createdAt'>): number {
    const result = this.insertStmt.run({
      game_id: entry.gameId,
      call_type: entry.callType,
      model: entry.model,
      prompt_tokens: entry.promptTokens,
      completion_tokens: entry.completionTokens,
      latency_ms: entry.latencyMs,
      cost_usd: entry.costUsd,
    });
    return Number(result.lastInsertRowid);
  }

  findByGameId(gameId: string): LlmLogEntry[] {
    const rows = this.findByGameStmt.all(gameId) as LlmLogRow[];
    return rows.map(rowToEntry);
  }

  findById(id: number): LlmLogEntry | undefined {
    const row = this.findByIdStmt.get(id) as LlmLogRow | undefined;
    return row ? rowToEntry(row) : undefined;
  }

  getTotalCost(gameId: string): number {
    const row = this.totalCostStmt.get(gameId) as { total: number | null } | undefined;
    return row?.total ?? 0;
  }

  getCostBreakdown(gameId: string): CostBreakdown[] {
    const rows = this.costByGameAndTypeStmt.all(gameId) as Array<{
      call_type: string;
      total_cost_usd: number;
      total_calls: number;
    }>;
    return rows.map((r) => ({
      callType: r.call_type,
      totalCostUsd: r.total_cost_usd,
      totalCalls: r.total_calls,
    }));
  }

  getRecentByGameId(gameId: string, limit = 20): LlmLogEntry[] {
    const rows = this.recentByGameStmt.all(gameId, limit) as LlmLogRow[];
    return rows.map(rowToEntry);
  }
}

// ── Mapping ──────────────────────────────────────────────

function rowToEntry(row: LlmLogRow): LlmLogEntry {
  return {
    id: row.id,
    gameId: row.game_id,
    callType: row.call_type,
    model: row.model,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    latencyMs: row.latency_ms,
    costUsd: row.cost_usd,
    createdAt: row.created_at,
  };
}
