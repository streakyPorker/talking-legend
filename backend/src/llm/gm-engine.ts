/**
 * RFC-005: GM 叙事生成引擎。
 *
 * 组合 LLMClient + TemplateEngine + ContextProvider，产生流式 GM 叙事。
 * 处理降级、日志记录和叙事持久化。
 */

import { Injectable, Inject } from '@nestjs/common';
import { LegendLogger } from '../common/logger/legend.logger';
import { LLMClient } from './client';
import { TemplateEngine } from '../prompts/template-engine';
import type { AssembledContext } from '../context/context-module.interface';
import { LlmLogRepository } from '../db/repositories/llm-log.repository';
import { NarrativeService } from '../game/narrative.service';
import { ContextProvider } from '../game/context-provider';
import { ToolRegistry } from './tool-registry';
import { GM_NARRATIVE_USER_PARAMS } from '../prompts/schemas/gm/narrative.schema';

// ─── 事件类型 ──────────────────────────────────────────────

export interface GMChunkEvent { type: 'chunk'; content: string }
export interface GMDoneEvent { type: 'done'; turn: number; tokenEstimate: number; narrative?: string; inputTokens?: number; outputTokens?: number }
export type GMStreamEvent = GMChunkEvent | GMDoneEvent;

// ─── 服务 ──────────────────────────────────────────────────

@Injectable()
export class GMEngine {
  private readonly logger = new LegendLogger(GMEngine.name);

  constructor(
    private readonly llmClient: LLMClient,
    private readonly templateEngine: TemplateEngine,
    private readonly contextProvider: ContextProvider,
    @Inject(LlmLogRepository) private readonly llmLogRepo: LlmLogRepository,
    private readonly narrativeService: NarrativeService,
    private readonly toolRegistry: ToolRegistry,
  ) {}

  async *generateWithTools(
    gameId: string,
    action: string,
    target: string | undefined,
    turn: number,
  ): AsyncIterable<GMStreamEvent | { type: 'tool_call'; name: string; args: Record<string, unknown> } | { type: 'tool_result'; success: boolean; message: string; stateChanges?: Record<string, unknown> }> {
    const startTime = Date.now();
    const MAX_CONSECUTIVE_FAILURES = 3;

    this.logger.log(`GM generateWithTools started: gameId=${gameId} action=${action}`);
    const tools = this.toolRegistry.getToolsForLLM();
    this.logger.debug(`Tools available: [${tools.map(t => t.name).join(', ')}]`);

    // Build context same as generate()
    let ctx: AssembledContext;
    try {
      ctx = await this.contextProvider.buildGMContext(gameId, 180_000);
    } catch {
      this.logger.warn(`Context build failed (generateWithTools) for gameId=${gameId}, action=${action}, using fallback`);
      yield { type: 'chunk', content: this.fallbackNarrative(action) };
      yield { type: 'done', turn, tokenEstimate: 0 };
      return;
    }

    const userParams: Record<string, string> = {
      playerAction: action,
      target: target ?? '无',
    };
    const userPrompt = this.templateEngine.render('gm.narrative.user', userParams, GM_NARRATIVE_USER_PARAMS);

    // Build messages array for multi-turn tool use loop
    const messages: Array<{ role: 'user' | 'assistant'; content: string | Array<Record<string, unknown>> }> = [
      { role: 'user', content: userPrompt },
    ];

    let finalTurn = turn;
    let consecutiveFailures = 0;
    let fullText = '';
    let apiUsage: { inputTokens: number; outputTokens: number } | null = null;

    // Tool use loop
    let iteration = 0;
    while (true) {
      iteration++;
      this.logger.debug(`Tool use loop iteration ${iteration}`);
      let hasToolUse = false;

      try {
        for await (const event of this.llmClient.stream({
          model: this.llmClient.opusModel,
          systemPrompt: ctx.systemPrompt,
          userPrompt: '', // not used when messages present
          maxTokens: 8192,
          messages: messages.map(m => ({
            role: m.role,
            content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
          })),
          tools: tools.length > 0 ? tools : undefined,
        })) {
          if (event.type === 'chunk') {
            fullText += event.content;
            yield { type: 'chunk', content: event.content };
          } else if (event.type === 'tool_use') {
            hasToolUse = true;
            this.logger.log(`Tool called: name=${event.name} args=${JSON.stringify(event.input)}`);
            yield { type: 'tool_call', name: event.name, args: event.input };

            // Execute tool
            const result = await this.toolRegistry.execute(event.name, gameId, event.input);
            this.logger.log(`Tool result: success=${result.success} message=${result.message}`);
            yield { type: 'tool_result', success: result.success, message: result.message, stateChanges: result.stateChanges };

            if (result.success) {
              consecutiveFailures = 0;
              if (result.stateChanges?.gameState) {
                const gs = result.stateChanges.gameState as Record<string, unknown>;
                if (typeof gs.turn === 'number') finalTurn = gs.turn;
              }
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
        this.logger.error(`LLM stream error (generateWithTools): ${err instanceof Error ? err.message : String(err)}`);
        this.logger.warn(`Using fallback narrative for action=${action}`);
        const fallback = this.fallbackNarrative(action);
        fullText = fallback;
        yield { type: 'chunk', content: fallback };
        break;
      }

      // Stop conditions
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        this.logger.warn(`Max consecutive failures (${MAX_CONSECUTIVE_FAILURES}) reached, halting tool use loop`);
        yield { type: 'chunk', content: '\n\n（多次操作失败，行动被迫中断。）' };
        break;
      }
      if (!hasToolUse) break; // LLM chose not to use tools, natural end
    }

    // Log and persist (same as generate())
    const latencyMs = Date.now() - startTime;
    try {
      this.llmLogRepo.insert({
        gameId, callType: 'gm_narrative', model: this.llmClient.opusModel,
        promptTokens: apiUsage?.inputTokens ?? ctx.tokenEstimate,
        completionTokens: apiUsage?.outputTokens ?? Math.ceil(fullText.length / 2),
        latencyMs, costUsd: 0,
      });
    } catch { /* silent */ }
    try { this.narrativeService.append(gameId, finalTurn, fullText); } catch { /* silent */ }

    this.logger.log(`GM generateWithTools done: turn=${finalTurn} tokenEstimate=${ctx.tokenEstimate}`);
    yield { type: 'done', turn: finalTurn, tokenEstimate: ctx.tokenEstimate, narrative: fullText, ...(apiUsage ? { inputTokens: apiUsage.inputTokens, outputTokens: apiUsage.outputTokens } : {}) };
  }

  private fallbackNarrative(action: string): string {
    return `你${action}。世界屏息凝神，等待下一章的到来…`;
  }
}
