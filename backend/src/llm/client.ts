/**
 * LLM Client — abstraction over the AI model provider.
 *
 * Design principles:
 * - Uses @anthropic-ai/sdk instead of raw fetch() + SSE parsing
 * - Timeout: 30s default for call(), 60s for stream()
 * - Retry: up to 3 attempts with exponential backoff
 * - Degradation: graceful fallback to placeholder when LLM is unavailable
 * - Streaming: SDK's event-based streaming with push-yield bridge
 */

import { Injectable } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import { LegendLogger } from '../common/logger/legend.logger';
import Anthropic from '@anthropic-ai/sdk';

export interface LLMConfig {
  provider: 'anthropic' | 'openai';
  apiKey: string;
  model: string;
  timeoutMs?: number;
  maxRetries?: number;
  baseUrl?: string;
}

export interface LLMCallOptions {
  systemPrompt: string;
  userPrompt: string;
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
  temperature?: number;
  maxTokens?: number;
  thinkingBudget?: number;
  tools?: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>;
}

export interface LLMCallResult {
  content: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cost: number;
  };
}

export type StreamChunk =
  | { type: 'chunk'; content: string }
  | { type: 'tool_use'; name: string; id: string; input: Record<string, unknown> }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'stream_end' };

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_STREAM_TIMEOUT_MS = 60_000;

/**
 * Convert a message from LLMCallOptions format to Anthropic SDK MessageParam.
 * Handles JSON-stringified content blocks (from gm-engine.ts generateWithTools).
 */
function convertMessageParam(
  msg: { role: 'user' | 'assistant'; content: string },
): Anthropic.Messages.MessageParam {
  // If the content string looks like a JSON array of content blocks,
  // parse it into proper ContentBlockParam[] for the SDK.
  if (msg.content.startsWith('[') || msg.content.startsWith('{')) {
    try {
      const parsed = JSON.parse(msg.content);
      if (Array.isArray(parsed)) {
        return { role: msg.role, content: parsed as Anthropic.Messages.ContentBlockParam[] };
      }
    } catch {
      // Not valid JSON — treat as plain text
    }
  }
  return { role: msg.role, content: msg.content };
}

@Injectable()
export class LLMClient {
  private readonly logger = new LegendLogger(LLMClient.name);
  private readonly anthropic: Anthropic;

  constructor(private readonly config: ConfigService) {
    this.anthropic = new Anthropic({
      apiKey: this.config.llmApiKey,
      baseURL: this.config.llmBaseUrl,
      maxRetries: 0, // We handle retries ourselves
    });
  }

  /** Convenience getters for the three model tiers */
  get opusModel(): string {
    return this.config.llmOpusModel;
  }
  get sonnetModel(): string {
    return this.config.llmSonnetModel;
  }
  get haikuModel(): string {
    return this.config.llmHaikuModel;
  }

  // ── Non-streaming call ────────────────────────────────────────────

  async call(options: LLMCallOptions): Promise<LLMCallResult> {
    const model = this.config.llmSonnetModel;
    this.logger.debug(
      `LLM call: model=${model} maxTokens=${options.maxTokens ?? 1024} hasTools=${Boolean(options.tools?.length)}`,
    );

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= DEFAULT_MAX_RETRIES; attempt++) {
      try {
        const startTime = Date.now();
        const result = await this._callWithTimeout(options);
        const latency = Date.now() - startTime;
        this.logger.log(
          `LLM call completed: inputTokens=${result.usage.inputTokens} outputTokens=${result.usage.outputTokens} latency=${latency}ms`,
        );
        return result;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < DEFAULT_MAX_RETRIES) {
          const delay = Math.pow(2, attempt) * 1000;
          this.logger.debug(
            `Retry attempt ${attempt + 1} after error: ${lastError.message}`,
          );
          this.logger.warn(
            `LLM call retry ${attempt + 1}/${DEFAULT_MAX_RETRIES} after: ${lastError.message}`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    // All retries exhausted — return a graceful fallback
    this.logger.error(
      `LLM call failed after ${DEFAULT_MAX_RETRIES} retries: ${lastError?.message}`,
    );
    return this.fallbackResponse(options, lastError);
  }

  // ── Streaming call ────────────────────────────────────────────────

  /**
   * Stream LLM response using the Anthropic SDK.
   * Yields `StreamChunk` objects as the model generates output.
   *
   * Supports extended thinking via `thinkingBudget`: when > 0, enables
   * Anthropic's `thinking` parameter with the given budget.
   * `thinking` content blocks are received but NOT yielded.
   *
   * When `options.messages` is provided, it is prepended before the
   * user prompt to support multi-turn conversations.
   *
   * @param options.model - Model ID; use one of the getters
   *   (opusModel / sonnetModel / haikuModel).
   */
  async *stream(
    options: LLMCallOptions & { maxTokens?: number; model: string },
  ): AsyncIterable<StreamChunk> {
    const thinkingBudget = options.thinkingBudget ?? this.defaultThinkingBudget(options.model);
    const maxTokens = options.maxTokens ?? this.getDefaultMaxTokens(options.model);
    this.logger.debug(
      `LLM stream started: model=${options.model} maxTokens=${maxTokens} thinkingBudget=${thinkingBudget}`,
    );

    // Build the thinking param if budget > 0
    const thinking = thinkingBudget > 0
      ? { type: 'enabled' as const, budget_tokens: thinkingBudget }
      : undefined;

    // Build messages array: history (if any) + user prompt
    // Handle both string content and JSON-stringified content blocks
    // (gm-engine.ts may stringify tool_use/tool_result arrays for transport)
    const messages: Array<Anthropic.Messages.MessageParam> = [
      ...((options.messages ?? []).map(convertMessageParam)),
      { role: 'user', content: options.userPrompt },
    ];

    // Build tools array in Anthropic SDK format
    const anthropicTools = options.tools?.length
      ? options.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema as Anthropic.Messages.Tool.InputSchema,
        }))
      : undefined;

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let chunkCount = 0;

    try {
      const streamInstance = this.anthropic.messages.stream(
        {
          model: options.model,
          system: options.systemPrompt,
          messages,
          max_tokens: maxTokens,
          temperature: options.temperature ?? 0.7,
          ...(thinking !== undefined ? { thinking } : {}),
          ...(anthropicTools !== undefined ? { tools: anthropicTools } : {}),
        },
        {
          timeout: DEFAULT_STREAM_TIMEOUT_MS,
        },
      );

      // ── Push-yield bridge ───────────────────────────────────
      // Event handlers push into a queue; the async generator
      // drains the queue by awaiting a deferred promise each time.
      type QueueItem = StreamChunk;
      const queue: QueueItem[] = [];
      let drainPromise: (() => void) | null = null;
      let streamError: Error | null = null;

      function pushOrWake(item: QueueItem): void {
        queue.push(item);
        if (drainPromise) {
          drainPromise();
          drainPromise = null;
        }
      }

      // Text deltas → chunk events
      streamInstance.on('text', (textDelta: string) => {
        chunkCount++;
        pushOrWake({ type: 'chunk', content: textDelta });
      });

      // Content block start (tool_use detection — initial metadata)
      // We collect tool_use input progressively via inputJson event
      const toolUseData: Map<string, { name: string; id: string; input: Record<string, unknown> }> = new Map();

      streamInstance.on('contentBlock', (block) => {
        if (block.type === 'tool_use') {
          toolUseData.set(block.id, {
            name: block.name,
            id: block.id,
            input: {},
          });
        }
      });

      // Progressive input_json for tool_use blocks
      streamInstance.on('inputJson', (partialJson: string, jsonSnapshot: unknown) => {
        // inputJson fires for tool_use blocks; we can update input progressively
        // but we'll yield the final tool_use after stream completion
      });

      // Error handling
      streamInstance.on('error', (error: Error) => {
        streamError = error;
        pushOrWake({ type: 'stream_end' });
      });

      // End handling
      streamInstance.on('end', () => {
        // Signal drain to stop waiting
        if (drainPromise) {
          drainPromise();
          drainPromise = null;
        }
      });

      // ── Drain loop ──────────────────────────────────────────
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (streamError) {
          this.logger.error(`LLM stream error: ${(streamError as Error).message}`);
          yield { type: 'stream_end' };
          return;
        }

        // Drain available items
        while (queue.length > 0) {
          const item = queue.shift()!;
          yield item;
          if (item.type === 'stream_end') {
            // The stream ended from within an event handler
            return;
          }
        }

        // Check if stream is done (no more events will arrive)
        if (streamInstance.ended) {
          break;
        }

        // Wait for more items
        await new Promise<void>((resolve) => {
          drainPromise = resolve;
        });
      }

      // After stream ends naturally, get final message for usage + tool_use
      let finalMessage: Anthropic.Messages.Message;
      try {
        finalMessage = await streamInstance.finalMessage();
      } catch {
        // If finalMessage fails, stream is already closed — signal end
        yield { type: 'stream_end' };
        return;
      }

      // Extract usage from final message
      if (finalMessage.usage) {
        totalInputTokens = finalMessage.usage.input_tokens ?? 0;
        totalOutputTokens = finalMessage.usage.output_tokens ?? 0;
      }

      // Extract tool_use blocks from final message
      const toolUseBlocks = finalMessage.content
        .filter((block): block is Anthropic.Messages.ToolUseBlock =>
          block.type === 'tool_use',
        );

      // If we have tool_use blocks, yield them now
      for (const tb of toolUseBlocks) {
        yield {
          type: 'tool_use',
          name: tb.name,
          id: tb.id,
          input: tb.input as Record<string, unknown>,
        };
      }

      // Yield usage stats
      yield {
        type: 'usage',
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
      };

      this.logger.log(
        `LLM stream completed: inputTokens=${totalInputTokens} outputTokens=${totalOutputTokens} chunks=${chunkCount}`,
      );

      yield { type: 'stream_end' };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`LLM stream error: ${errorMsg}`);
      yield { type: 'stream_end' };
    }
  }

  // ── Thinking / max_tokens defaults ─────────────────────────────────

  /**
   * Return the default thinking budget for the given model.
   * Haiku does not support extended thinking => 0.
   */
  private defaultThinkingBudget(model: string): number {
    if (this.isOpusModel(model)) return this.config.llmThinkingOpus;
    if (this.isSonnetModel(model)) return this.config.llmThinkingSonnet;
    return 0; // Haiku — no thinking support
  }

  /**
   * Return the default max_tokens for the given model.
   * These are the RFC-013 "5x" defaults, configurable via env.
   */
  private getDefaultMaxTokens(model: string): number {
    if (this.isOpusModel(model)) return this.config.llmMaxTokensOpus;
    if (this.isSonnetModel(model)) return this.config.llmMaxTokensSonnet;
    return this.config.llmMaxTokensHaiku;
  }

  /** Check whether `model` string matches the configured Opus tier (prefix match from config.toml [model_tiers]) */
  private isOpusModel(model: string): boolean {
    const prefixes = this.config.opusModelPrefixes;
    if (prefixes.length > 0) return prefixes.some((p) => model.includes(p));
    return model === this.config.llmOpusModel; // fallback: exact match
  }

  /** Check whether `model` string matches the configured Sonnet tier (prefix match from config.toml [model_tiers]) */
  private isSonnetModel(model: string): boolean {
    const prefixes = this.config.sonnetModelPrefixes;
    if (prefixes.length > 0) return prefixes.some((p) => model.includes(p));
    return model === this.config.llmSonnetModel; // fallback: exact match
  }

  // ── Private helpers ─────────────────────────────────────────────────

  private async _callWithTimeout(
    options: LLMCallOptions,
  ): Promise<LLMCallResult> {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      DEFAULT_TIMEOUT_MS,
    );

    try {
      const message = await this.anthropic.messages.create(
        {
          model: this.config.llmSonnetModel,
          system: options.systemPrompt,
          messages: [{ role: 'user', content: options.userPrompt }],
          max_tokens: options.maxTokens ?? 1024,
          temperature: options.temperature ?? 0.7,
        },
        {
          signal: controller.signal,
        },
      );

      const textContent = message.content
        .filter((block): block is Anthropic.Messages.TextBlock =>
          block.type === 'text',
        )
        .map((block) => block.text)
        .join('');

      return {
        content: textContent || JSON.stringify(message),
        usage: {
          inputTokens: message.usage?.input_tokens ?? 0,
          outputTokens: message.usage?.output_tokens ?? 0,
          cost: 0, // Will be calculated per-model in a future update
        },
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private fallbackResponse(
    _options: LLMCallOptions,
    error: Error | null,
  ): LLMCallResult {
    this.logger.warn(
      `Using fallback response, last error: ${error?.message}`,
    );
    return {
      content: 'The world holds its breath, awaiting the next chapter...',
      usage: { inputTokens: 0, outputTokens: 0, cost: 0 },
    };
  }
}
