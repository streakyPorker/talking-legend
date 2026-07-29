/**
 * RFC-006: NPC 对话生成引擎。
 *
 * 组合 LLMClient + ContextProvider，产生流式 NPC 对话。
 * 处理降级、日志记录和情绪更新。
 */

import { Injectable, Inject } from '@nestjs/common';
import { LLMClient } from './client';
import type { AssembledContext } from '../context/context-module.interface';
import { LlmLogRepository } from '../db/repositories/llm-log.repository';
import { NpcRepository } from '../db/repositories/npc.repository';
import { ContextProvider } from '../game/context-provider';
import type { NPCState } from '@talking-legend/shared';

// ─── 事件类型 ──────────────────────────────────────────────

export interface NpcChunkEvent { type: 'chunk'; content: string }
export interface NpcDoneEvent { type: 'done'; turn: number; tokenEstimate: number; inputTokens?: number; outputTokens?: number }
export type NpcStreamEvent = NpcChunkEvent | NpcDoneEvent;

// ─── 服务 ──────────────────────────────────────────────────

@Injectable()
export class NpcEngine {
  constructor(
    private readonly llmClient: LLMClient,
    private readonly contextProvider: ContextProvider,
    @Inject(LlmLogRepository) private readonly llmLogRepo: LlmLogRepository,
    @Inject(NpcRepository) private readonly npcRepo: NpcRepository,
  ) {}

  async *generate(
    gameId: string,
    npc: NPCState,
    playerMessage: string,
    playerName: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
  ): AsyncIterable<NpcStreamEvent> {
    const startTime = Date.now();

    // 1. ContextBuilder 模块管线 → system prompt
    let ctx: AssembledContext;
    try {
      ctx = await this.contextProvider.buildNpcContext(gameId, npc.id, 50_000);
    } catch {
      const fallback = this.fallbackDialogue(npc.name);
      yield { type: 'chunk', content: fallback };
      yield { type: 'done', turn: -1, tokenEstimate: 0 };
      return;
    }

    // 2. User prompt = 对话历史 + 当前消息
    const userPrompt = [
      ...history.map((h) => `${h.role === 'user' ? playerName : npc.name}：${h.content}`),
      `${playerName}：${playerMessage}`,
    ].join('\n');

    // 3. 流式 LLM（Sonnet, temperature 0.9）
    let fullText = '';
    let apiUsage: { inputTokens: number; outputTokens: number } | null = null;

    try {
      for await (const event of this.llmClient.stream({
        model: this.llmClient.sonnetModel,
        systemPrompt: ctx.systemPrompt,
        userPrompt,
        temperature: 0.9,
        messages: history,
      })) {
        if (event.type === 'chunk') {
          fullText += event.content;
          yield { type: 'chunk', content: event.content };
        } else if (event.type === 'usage') {
          apiUsage = { inputTokens: event.inputTokens, outputTokens: event.outputTokens };
        }
      }
    } catch (err) {
      console.error('[NpcEngine] LLM stream failed:', (err as Error).message || err);
      const fallback = this.fallbackDialogue(npc.name);
      fullText = fallback;
      yield { type: 'chunk', content: fallback };
    }

    // 4. 后处理（同步，try/catch 静默）
    const latencyMs = Date.now() - startTime;
    try {
      this.llmLogRepo.insert({
        gameId,
        callType: 'npc_dialogue',
        model: this.llmClient.sonnetModel,
        promptTokens: apiUsage?.inputTokens ?? ctx.tokenEstimate,
        completionTokens: apiUsage?.outputTokens ?? Math.ceil(fullText.length / 2),
        latencyMs,
        costUsd: 0,
      });
    } catch { /* 静默 — 日志记录失败不阻断流程 */ }

    try {
      this.npcRepo.addMemory(npc.id, playerMessage, 0); // 同步兜底，turn=0 NPC 对话
    } catch { /* 静默 */ }

    try { this.updateMood(npc, fullText); } catch { /* 静默 */ }

    yield {
      type: 'done',
      turn: -1,
      tokenEstimate: ctx.tokenEstimate,
      ...(apiUsage ? { inputTokens: apiUsage.inputTokens, outputTokens: apiUsage.outputTokens } : {}),
    };
  }

  /** 降级对话 */
  private fallbackDialogue(npcName: string): string {
    return `${npcName}沉默了片刻，似乎陷入了沉思。`;
  }

  /** 从 LLM 回复中提取 [mood: xxx] 标记并更新 NPC 情绪 */
  private updateMood(npc: NPCState, response: string): void {
    const match = response.match(/\[mood:\s*(\S+)\]/);
    if (match) {
      this.npcRepo.update(npc.id, { currentMood: match[1] });
    }
  }
}
