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

  private fallbackNarrative(action: string): string {
    return `你${action}。世界屏息凝神，等待下一章的到来…`;
  }
}
