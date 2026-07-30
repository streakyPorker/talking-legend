/**
 * RFC-006: NPC 对话生成引擎。
 * RFC-011: 新增 generateWithTools() + 新事件协议。
 *
 * 组合 LLMClient + ContextProvider，产生流式 NPC 对话。
 * 处理降级、日志记录和情绪更新。
 */

import { Injectable, Inject } from '@nestjs/common';
import { LegendLogger } from '../common/logger/legend.logger';
import { LLMClient } from './client';
import type { AssembledContext } from '../context/context-module.interface';
import { LlmLogRepository } from '../db/repositories/llm-log.repository';
import { NpcRepository } from '../db/repositories/npc.repository';
import { ContextProvider } from '../game/context-provider';
import type { NPCState } from '@talking-legend/shared';
import { ToolRegistry } from './tool-registry';

// ─── 事件类型 (RFC-011) ─────────────────────────────────────

export interface NpcChunkEvent { type: 'chunk'; content: string }
export interface NpcDoneEvent { type: 'done'; turn: number; tokenEstimate: number; inputTokens?: number; outputTokens?: number }
export interface NpcDialogueChunkEvent { type: 'dialogue_chunk'; speaker: string; content: string }
export interface NpcMoodChangeEvent { type: 'mood_change'; mood: string }
export type NpcStreamEvent = NpcChunkEvent | NpcDoneEvent | NpcDialogueChunkEvent | NpcMoodChangeEvent;

// ─── 服务 ──────────────────────────────────────────────────

@Injectable()
export class NpcEngine {
  private readonly logger = new LegendLogger(NpcEngine.name);

  constructor(
    private readonly llmClient: LLMClient,
    private readonly contextProvider: ContextProvider,
    @Inject(LlmLogRepository) private readonly llmLogRepo: LlmLogRepository,
    @Inject(NpcRepository) private readonly npcRepo: NpcRepository,
    private readonly toolRegistry: ToolRegistry,
  ) {}

  async *generate(
    gameId: string,
    npc: NPCState,
    playerMessage: string,
    playerName: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
  ): AsyncIterable<NpcStreamEvent> {
    const startTime = Date.now();
    this.logger.log(`NPC dialogue: gameId=${gameId} npcId=${npc.id} playerMessage="${playerMessage.slice(0, 80)}"`);

    // 1. ContextBuilder 模块管线 → system prompt
    let ctx: AssembledContext;
    try {
      ctx = await this.contextProvider.buildNpcContext(gameId, npc.id, 50_000);
    } catch {
      this.logger.warn('Using NPC fallback response');
      const fallback = this.fallbackDialogue(npc.name);
      yield { type: 'chunk', content: fallback };
      yield { type: 'done', turn: -1, tokenEstimate: 0 };
      return;
    }

    this.logger.debug(`NPC context built, tokenEstimate=${ctx.tokenEstimate}`);

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
      this.logger.error(`NPC dialogue LLM error: ${(err as Error).message || err}`);
      this.logger.warn('Using NPC fallback response');
      const fallback = this.fallbackDialogue(npc.name);
      fullText = fallback;
      yield { type: 'chunk', content: fallback };
    }

    if (apiUsage) {
      this.logger.log(`NPC dialogue completed: inputTokens=${apiUsage.inputTokens} outputTokens=${apiUsage.outputTokens}`);
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

  /**
   * RFC-011: NPC 对话 tool_use 版。
   * 与 generate() 行为相同，增加了 tool_use 循环支持。
   * 使用新事件协议：dialogue_chunk / mood_change / done / error。
   */
  async *generateWithTools(
    gameId: string,
    npc: NPCState,
    playerMessage: string,
    playerName: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
  ): AsyncIterable<NpcDialogueChunkEvent | NpcMoodChangeEvent | NpcDoneEvent | { type: 'error'; message: string } | { type: 'tool_call'; name: string; args: Record<string, unknown> } | { type: 'tool_result'; success: boolean; message: string }> {
    const startTime = Date.now();
    this.logger.log(`NPC generateWithTools: gameId=${gameId} npcId=${npc.id} playerMessage="${playerMessage.slice(0, 80)}"`);

    // 1. Build context (same as generate)
    let ctx: AssembledContext;
    try {
      ctx = await this.contextProvider.buildNpcContext(gameId, npc.id, 50_000);
    } catch (err) {
      this.logger.warn(`NPC context build failed for gameId=${gameId}, using fallback`);
      yield { type: 'dialogue_chunk', speaker: npc.name, content: this.fallbackDialogue(npc.name) };
      yield { type: 'done', turn: -1, tokenEstimate: 0 };
      return;
    }

    // 2. Build messages array for multi-turn tool use
    const userPrompt = [
      ...history.map((h) => `${h.role === 'user' ? playerName : npc.name}：${h.content}`),
      `${playerName}：${playerMessage}`,
    ].join('\n');

    const messages: Array<{ role: 'user' | 'assistant'; content: string | Array<Record<string, unknown>> }> = [
      { role: 'user', content: userPrompt },
    ];

    const tools = this.toolRegistry.getToolsForLLM();
    this.logger.debug(`NPC tools available: [${tools.map(t => t.name).join(', ')}]`);

    let fullText = '';
    let apiUsage: { inputTokens: number; outputTokens: number } | null = null;
    const MAX_CONSECUTIVE_FAILURES = 3;
    let consecutiveFailures = 0;

    // 3. Tool use loop
    let iteration = 0;
    while (true) {
      iteration++;
      this.logger.debug(`NPC tool use loop iteration ${iteration}`);
      let hasToolUse = false;

      try {
        for await (const event of this.llmClient.stream({
          model: this.llmClient.sonnetModel,
          systemPrompt: ctx.systemPrompt,
          userPrompt: '', // not used when messages present
          temperature: 0.9,
          maxTokens: 5120,
          messages: messages.map(m => ({
            role: m.role,
            content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
          })),
          tools: tools.length > 0 ? tools : undefined,
        })) {
          if (event.type === 'chunk') {
            fullText += event.content;
            yield { type: 'dialogue_chunk', speaker: npc.name, content: event.content };
          } else if (event.type === 'tool_use') {
            hasToolUse = true;
            this.logger.log(`NPC tool called: name=${event.name} args=${JSON.stringify(event.input)}`);
            yield { type: 'tool_call', name: event.name, args: event.input };

            // Execute tool
            const result = await this.toolRegistry.execute(event.name, gameId, event.input);
            this.logger.log(`NPC tool result: success=${result.success} message=${result.message}`);
            yield { type: 'tool_result', success: result.success, message: result.message };

            if (result.success) {
              consecutiveFailures = 0;
            } else {
              consecutiveFailures++;
            }

            // Inject tool use + result into messages
            messages.push({
              role: 'assistant',
              content: [{ type: 'tool_use', id: event.id, name: event.name, input: event.input }],
            });
            messages.push({
              role: 'user',
              content: [{ type: 'tool_result', tool_use_id: event.id, content: result.message }],
            });
          } else if (event.type === 'usage') {
            apiUsage = { inputTokens: event.inputTokens, outputTokens: event.outputTokens };
          }
        }
      } catch (err) {
        this.logger.error(`NPC LLM stream error (generateWithTools): ${(err as Error).message || err}`);
        const fallback = this.fallbackDialogue(npc.name);
        fullText = fallback;
        yield { type: 'dialogue_chunk', speaker: npc.name, content: fallback };
        break;
      }

      // Stop conditions
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        this.logger.warn(`NPC max consecutive tool failures (${MAX_CONSECUTIVE_FAILURES}) reached`);
        yield { type: 'dialogue_chunk', speaker: npc.name, content: '\n\n（操作似乎没有生效。）' };
        break;
      }
      if (!hasToolUse) break; // Natural end
    }

    // 4. Post-processing
    const latencyMs = Date.now() - startTime;
    try {
      this.llmLogRepo.insert({
        gameId, callType: 'npc_dialogue', model: this.llmClient.sonnetModel,
        promptTokens: apiUsage?.inputTokens ?? ctx.tokenEstimate,
        completionTokens: apiUsage?.outputTokens ?? Math.ceil(fullText.length / 2),
        latencyMs, costUsd: 0,
      });
    } catch { /* silent */ }

    try { this.npcRepo.addMemory(npc.id, playerMessage, 0); } catch { /* silent */ }

    // Check for mood change
    try {
      const moodMatch = fullText.match(/\[mood:\s*(\S+)\]/);
      if (moodMatch) {
        this.npcRepo.update(npc.id, { currentMood: moodMatch[1] });
        yield { type: 'mood_change', mood: moodMatch[1] };
      }
    } catch { /* silent */ }

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
