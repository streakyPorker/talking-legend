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
  temperature?: number;
  maxTokens?: number;
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
    const maxRetries = DEFAULT_MAX_RETRIES;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this._callWithTimeout(options);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000;
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    // All retries exhausted — return a graceful fallback
    return this.fallbackResponse(options, lastError);
  }

  // ── Streaming call ──────────────────────────────────────────────────

  /**
   * Stream LLM response via SSE (server-sent events).
   * Yields `StreamChunk` objects as the model generates output.
   *
   * @param options.model - Model ID; use one of the getters
   *   (opusModel / sonnetModel / haikuModel).
   */
  async *stream(
    options: LLMCallOptions & { maxTokens?: number; model: string },
  ): AsyncIterable<StreamChunk> {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      DEFAULT_STREAM_TIMEOUT_MS,
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
            model: options.model,
            system: options.systemPrompt,
            messages: [{ role: 'user', content: options.userPrompt }],
            max_tokens: options.maxTokens ?? 1024,
            temperature: options.temperature ?? 0.7,
            stream: true,
          }),
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`LLM stream API error ${response.status}: ${text}`);
      }

      if (!response.body) {
        throw new Error('LLM stream response has no body');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

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
            const payload: SSEPayload = JSON.parse(jsonStr);

            switch (payload.type) {
              case 'content_block_start':
                // A content block has started; no text yet, but we
                // can record which kind of block (text, tool_use, etc.)
                break;

              case 'content_block_delta': {
                const textDelta = payload.delta?.text;
                if (payload.delta?.type === 'text_delta' && textDelta) {
                  yield { type: 'chunk', content: textDelta };
                }
                break;
              }

              case 'message_delta': {
                const usage = payload.usage;
                if (usage) {
                  yield {
                    type: 'usage',
                    inputTokens: usage.input_tokens ?? 0,
                    outputTokens: usage.output_tokens ?? 0,
                  };
                }
                break;
              }

              case 'message_stop':
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
      yield { type: 'stream_end' };
    } finally {
      clearTimeout(timeoutId);
    }
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
    console.warn(
      `[LLM] Falling back to placeholder response. Error: ${error?.message}`,
    );
    return {
      content: 'The world holds its breath, awaiting the next chapter...',
      usage: { inputTokens: 0, outputTokens: 0, cost: 0 },
    };
  }
}
