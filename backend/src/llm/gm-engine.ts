/**
 * RFC-005: GM 叙事生成引擎。
 *
 * 组合 LLMClient + TemplateEngine + ContextProvider，产生流式 GM 叙事。
 * 处理降级、日志记录和叙事持久化。
 */

import { Injectable, Inject } from '@nestjs/common';
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
export interface GMDoneEvent { type: 'done'; turn: number; tokenEstimate: number; inputTokens?: number; outputTokens?: number }
export type GMStreamEvent = GMChunkEvent | GMDoneEvent;

// ─── 服务 ──────────────────────────────────────────────────

@Injectable()
export class GMEngine {
  constructor(
    private readonly llmClient: LLMClient,
    private readonly templateEngine: TemplateEngine,
    private readonly contextProvider: ContextProvider,
    @Inject(LlmLogRepository) private readonly llmLogRepo: LlmLogRepository,
    private readonly narrativeService: NarrativeService,
    private readonly toolRegistry: ToolRegistry,
  ) {}

  async *generate(
    gameId: string,
    action: string,
    target: string | undefined,
    turn: number,
  ): AsyncIterable<GMStreamEvent> {
    const startTime = Date.now();

    // 1. 构建系统 prompt
    let ctx: AssembledContext;
    try {
      ctx = await this.contextProvider.buildGMContext(gameId, 180_000);
    } catch (err) {
      // 上下文构建失败 → 降级
      const fallback = this.fallbackNarrative(action);
      yield { type: 'chunk', content: fallback };
      yield { type: 'done', turn, tokenEstimate: 0 };
      return;
    }

    // 2. 渲染用户 prompt
    const userParams: Record<string, string> = {
      playerAction: action,
      target: target ?? '无',
    };
    const userPrompt = this.templateEngine.render(
      'gm.narrative.user',
      userParams,
      GM_NARRATIVE_USER_PARAMS,
    );

    // 3. 流式 LLM 调用
    let fullText = '';
    let apiUsage: { inputTokens: number; outputTokens: number } | null = null;

    try {
      for await (const event of this.llmClient.stream({
        model: this.llmClient.opusModel,
        systemPrompt: ctx.systemPrompt,
        userPrompt,
        maxTokens: 8192,
      })) {
        if (event.type === 'chunk') {
          fullText += event.content;
          yield { type: 'chunk', content: event.content };
        } else if (event.type === 'usage') {
          apiUsage = { inputTokens: event.inputTokens, outputTokens: event.outputTokens };
        }
      }
    } catch (err) {
      const fallback = this.fallbackNarrative(action);
      fullText = fallback;
      yield { type: 'chunk', content: fallback };
    }

    // 4. 同步日志
    const latencyMs = Date.now() - startTime;
    try {
      this.llmLogRepo.insert({
        gameId,
        callType: 'gm_narrative',
        model: this.llmClient.opusModel,
        promptTokens: apiUsage?.inputTokens ?? ctx.tokenEstimate,
        completionTokens: apiUsage?.outputTokens ?? Math.ceil(fullText.length / 2),
        latencyMs,
        costUsd: 0,
      });
    } catch {
      /* 静默 — 日志记录失败不阻断流程 */
    }

    try {
      this.narrativeService.append(gameId, turn, fullText);
    } catch {
      /* 静默 — 叙事持久化失败不阻断流程 */
    }

    // 5. done 事件
    yield {
      type: 'done',
      turn,
      tokenEstimate: ctx.tokenEstimate,
      ...(apiUsage ? { inputTokens: apiUsage.inputTokens, outputTokens: apiUsage.outputTokens } : {}),
    };
  }

  async *generateWithTools(
    gameId: string,
    action: string,
    target: string | undefined,
    turn: number,
  ): AsyncIterable<GMStreamEvent | { type: 'tool_call'; name: string; args: Record<string, unknown> } | { type: 'tool_result'; success: boolean; message: string; stateChanges?: Record<string, unknown> }> {
    const startTime = Date.now();
    const MAX_CONSECUTIVE_FAILURES = 3;

    // Build context same as generate()
    let ctx: AssembledContext;
    try {
      ctx = await this.contextProvider.buildGMContext(gameId, 180_000);
    } catch {
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
    const tools = this.toolRegistry.getToolsForLLM();

    // Tool use loop
    while (true) {
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
            yield { type: 'tool_call', name: event.name, args: event.input };

            // Execute tool
            const result = await this.toolRegistry.execute(event.name, gameId, event.input);
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
        const fallback = this.fallbackNarrative(action);
        fullText = fallback;
        yield { type: 'chunk', content: fallback };
        break;
      }

      // Stop conditions
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
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

    yield { type: 'done', turn: finalTurn, tokenEstimate: ctx.tokenEstimate, ...(apiUsage ? { inputTokens: apiUsage.inputTokens, outputTokens: apiUsage.outputTokens } : {}) };
  }

  private fallbackNarrative(action: string): string {
    return `你${action}。世界屏息凝神，等待下一章的到来…`;
  }
}
