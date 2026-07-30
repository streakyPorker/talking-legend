/**
 * LLM Client — abstraction over the AI model provider.
 *
 * Design principles:
 * - Timeout: 30s default with configurable override
 * - Retry: up to 3 attempts with exponential backoff
 * - Degradation: graceful fallback to placeholder when LLM is unavailable
 * - Streaming: SSE-based AsyncGenerator with full Anthropic event handling
 */

import { Injectable } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import { LegendLogger } from '../common/logger/legend.logger';

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

/** Anthropic SSE event types we handle */
type AnthropicSSEEvent =
  | 'content_block_start'
  | 'content_block_delta'
  | 'message_delta'
  | 'message_stop'
  | 'error'
  | 'ping';

interface SSEPayload {
  type: AnthropicSSEEvent;
  content_block?: { type: string };
  delta?: { type: string; text?: string };
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { type: string; message: string };
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_STREAM_TIMEOUT_MS = 60_000;

@Injectable()
export class LLMClient {
  private readonly logger = new LegendLogger(LLMClient.name);

  constructor(private readonly config: ConfigService) {}

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

  // ── Non-streaming call (retained from original) ──────────────────────

  async call(options: LLMCallOptions): Promise<LLMCallResult> {
    const model = this.config.llmSonnetModel;
    this.logger.debug(
      `LLM call: model=${model} maxTokens=${options.maxTokens ?? 1024} hasTools=${Boolean(options.tools?.length)}`,
    );

    const maxRetries = DEFAULT_MAX_RETRIES;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
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
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000;
          this.logger.debug(
            `Retry attempt ${attempt + 1} after error: ${lastError.message}`,
          );
          this.logger.warn(
            `LLM call retry ${attempt + 1}/${maxRetries} after: ${lastError.message}`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    // All retries exhausted — return a graceful fallback
    this.logger.error(
      `LLM call failed after ${maxRetries} retries: ${lastError?.message}`,
    );
    return this.fallbackResponse(options, lastError);
  }

  // ── Streaming call ──────────────────────────────────────────────────

  /**
   * Stream LLM response via SSE (server-sent events).
   * Yields `StreamChunk` objects as the model generates output.
   *
   * Supports extended thinking via `thinkingBudget`: when > 0, enables
   * Anthropic's `thinking` parameter with the given budget.
   * `thinking_delta` content is received internally but NOT yielded.
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
    this.logger.debug(
      `LLM stream started: model=${options.model} maxTokens=${options.maxTokens ?? this.getDefaultMaxTokens(options.model)} thinkingBudget=${thinkingBudget}`,
    );

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      DEFAULT_STREAM_TIMEOUT_MS,
    );

    try {
      const thinking = thinkingBudget > 0
        ? { type: 'enabled' as const, budget_tokens: thinkingBudget }
        : undefined;

      const response = await fetch(
        `${this.config.llmBaseUrl}/v1/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.config.llmApiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: options.model,
            system: options.systemPrompt,
            messages: [
              ...(options.messages ?? []),
              { role: 'user', content: options.userPrompt },
            ],
            max_tokens: options.maxTokens ?? this.getDefaultMaxTokens(options.model),
            temperature: options.temperature ?? 0.7,
            ...(thinking !== undefined ? { thinking } : {}),
            ...(options.tools?.length ? { tools: options.tools } : {}),
            stream: true,
          }),
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        const text = await response.text();
        this.logger.error(`LLM stream API error status=${response.status}: ${text}`);
        throw new Error(`LLM stream API error ${response.status}: ${text}`);
      }

      if (!response.body) {
        throw new Error('LLM stream response has no body');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      // Track tool_use state across SSE events
      let currentToolUse: { name: string; id: string; json: string } | null = null;
      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let chunkCount = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        // Keep the last (possibly incomplete) line in the buffer
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;

          const jsonStr = trimmed.slice('data: '.length);
          if (jsonStr === '[DONE]') {
            yield { type: 'stream_end' };
            return;
          }

          try {
            const payload: SSEPayload & {
              content_block?: { type: string; name?: string; id?: string };
              delta?: { type: string; text?: string; partial_json?: string };
              message?: { stop_reason?: string };
            } = JSON.parse(jsonStr);

            switch (payload.type) {
              case 'content_block_start': {
                const block = payload.content_block;
                if (block?.type === 'tool_use') {
                  this.logger.debug(`Tool use received: name=${block.name}`);
                  // Flush any pending tool_use before starting a new block
                  if (currentToolUse) {
                    try {
                      yield {
                        type: 'tool_use',
                        name: currentToolUse.name,
                        id: currentToolUse.id,
                        input: JSON.parse(currentToolUse.json),
                      };
                    } catch { /* skip malformed JSON */ }
                    currentToolUse = null;
                  }
                  currentToolUse = { name: block.name ?? '', id: block.id ?? '', json: '' };
                }
                break;
              }

              case 'content_block_delta': {
                const delta = payload.delta;
                if (delta?.type === 'input_json_delta' && currentToolUse) {
                  currentToolUse.json += delta.partial_json ?? '';
                } else if (delta?.type === 'text_delta' && delta.text) {
                  chunkCount++;
                  yield { type: 'chunk', content: delta.text };
                }
                // thinking_delta: received but not yielded to caller
                break;
              }

              case 'message_delta': {
                // Flush pending tool_use before usage/stop info
                if (currentToolUse) {
                  try {
                    yield {
                      type: 'tool_use',
                      name: currentToolUse.name,
                      id: currentToolUse.id,
                      input: JSON.parse(currentToolUse.json),
                    };
                  } catch { /* skip malformed JSON */ }
                  currentToolUse = null;
                }
                const usage = payload.usage;
                if (usage) {
                  totalInputTokens = usage.input_tokens ?? 0;
                  totalOutputTokens = usage.output_tokens ?? 0;
                  yield {
                    type: 'usage',
                    inputTokens: totalInputTokens,
                    outputTokens: totalOutputTokens,
                  };
                }
                break;
              }

              case 'message_stop':
                this.logger.log(
                  `LLM stream completed: inputTokens=${totalInputTokens} outputTokens=${totalOutputTokens} chunks=${chunkCount}`,
                );
                yield { type: 'stream_end' };
                return;

              case 'error':
                throw new Error(
                  `LLM stream error: ${payload.error?.message ?? 'unknown error'}`,
                );

              case 'ping':
                // Heartbeat — ignore
                break;

              default:
                // Unknown event type — ignore silently
                break;
            }
          } catch (parseErr) {
            // If the JSON parse failed, it's likely a comment or
            // empty line — skip it silently.
            if (parseErr instanceof SyntaxError) continue;
            throw parseErr;
          }
        }
      }

      // If the loop ended without message_stop, signal stream_end
      this.logger.log(
        `LLM stream completed (no message_stop): inputTokens=${totalInputTokens} outputTokens=${totalOutputTokens} chunks=${chunkCount}`,
      );
      yield { type: 'stream_end' };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ── Thinking / max_tokens defaults ───────────────────────────────────

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
      const response = await fetch(
        `${this.config.llmBaseUrl}/v1/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.config.llmApiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: this.config.llmSonnetModel,
            system: options.systemPrompt,
            messages: [{ role: 'user', content: options.userPrompt }],
            max_tokens: options.maxTokens ?? 1024,
            temperature: options.temperature ?? 0.7,
          }),
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`LLM API error ${response.status}: ${text}`);
      }

      const data = (await response.json()) as Record<string, unknown>;
      return {
        content:
          (data as { content?: Array<{ text?: string }> }).content?.[0]
            ?.text ?? JSON.stringify(data),
        usage: {
          inputTokens:
            (data as { usage?: { input_tokens?: number } }).usage
              ?.input_tokens ?? 0,
          outputTokens:
            (data as { usage?: { output_tokens?: number } }).usage
              ?.output_tokens ?? 0,
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
