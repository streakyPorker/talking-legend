import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LLMClient, StreamChunk } from './client';
import { ConfigService } from '../config/config.service';

// ── Helpers ──────────────────────────────────────────────────────────────

/** Build a mock ConfigService with sane defaults for testing. */
function createMockConfig(overrides: Partial<ConfigService> = {}): ConfigService {
  return {
    llmApiKey: 'test-api-key',
    llmBaseUrl: 'https://api.anthropic.com',
    llmOpusModel: 'claude-opus-4-8',
    llmSonnetModel: 'claude-sonnet-4-6',
    llmHaikuModel: 'claude-haiku-4-5-20251001',
    llmMaxTokensOpus: 40960,
    llmMaxTokensSonnet: 5120,
    llmMaxTokensHaiku: 512,
    llmThinkingOpus: 4096,
    llmThinkingSonnet: 2048,
    opusModelPrefixes: [],
    sonnetModelPrefixes: [],
    ...overrides,
  } as ConfigService;
}

/** Create an SSE payload string from a JS object. */
function sseEvent(data: object): string {
  return `data: ${JSON.stringify(data)}\n`;
}

/** Helper: collect all chunks from a stream into an array. */
async function collectStream(
  stream: AsyncIterable<StreamChunk>,
): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('LLMClient', () => {
  let client: LLMClient;

  beforeEach(() => {
    client = new LLMClient(createMockConfig());
    vi.restoreAllMocks();
  });

  describe('stream() — thinking support', () => {
    it('includes thinking param in fetch body when default budget > 0 (Opus)', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(sseEvent({ type: 'message_stop' })));
            controller.close();
          },
        })),
      );

      const stream = client.stream({ model: client.opusModel, systemPrompt: 's', userPrompt: 'u' });
      await collectStream(stream);

      const callArgs = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(callArgs[1].body as string);
      expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 4096 });
    });

    it('omits thinking param when thinkingBudget is 0', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(sseEvent({ type: 'message_stop' })));
            controller.close();
          },
        })),
      );

      const stream = client.stream({
        model: client.opusModel,
        systemPrompt: 's',
        userPrompt: 'u',
        thinkingBudget: 0,
      });
      await collectStream(stream);

      const callArgs = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(callArgs[1].body as string);
      expect(body).not.toHaveProperty('thinking');
    });

    it('uses Haiku default thinking budget of 0', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(sseEvent({ type: 'message_stop' })));
            controller.close();
          },
        })),
      );

      const stream = client.stream({ model: client.haikuModel, systemPrompt: 's', userPrompt: 'u' });
      await collectStream(stream);

      const callArgs = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(callArgs[1].body as string);
      expect(body).not.toHaveProperty('thinking');
    });

    it('does NOT yield chunks for thinking_delta events', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(new ReadableStream({
          start(controller) {
            const encoder = new TextEncoder();
            // thinking block start
            controller.enqueue(encoder.encode(sseEvent({
              type: 'content_block_start',
              content_block: { type: 'thinking' },
            })));
            // thinking delta — should NOT yield
            controller.enqueue(encoder.encode(sseEvent({
              type: 'content_block_delta',
              delta: { type: 'thinking_delta', text: 'Hmm, let me think about this...' },
            })));
            // text block start
            controller.enqueue(encoder.encode(sseEvent({
              type: 'content_block_start',
              content_block: { type: 'text' },
            })));
            // text delta — should yield
            controller.enqueue(encoder.encode(sseEvent({
              type: 'content_block_delta',
              delta: { type: 'text_delta', text: 'Hello world' },
            })));
            controller.enqueue(encoder.encode(sseEvent({ type: 'message_stop' })));
            controller.close();
          },
        })),
      );

      const stream = client.stream({ model: client.opusModel, systemPrompt: 's', userPrompt: 'u' });
      const chunks = await collectStream(stream);

      // Only the text_delta 'Hello world' should appear as a chunk
      const contentChunks = chunks.filter((c) => c.type === 'chunk');
      expect(contentChunks).toHaveLength(1);
      expect(contentChunks[0]).toEqual({ type: 'chunk', content: 'Hello world' });
    });
  });

  describe('stream() — messages concatenation', () => {
    it('prepends history messages before user prompt', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(sseEvent({ type: 'message_stop' })));
            controller.close();
          },
        })),
      );

      const messages = [
        { role: 'user' as const, content: 'Who are you?' },
        { role: 'assistant' as const, content: 'I am the GM.' },
        { role: 'user' as const, content: 'Tell me more.' },
      ];

      const stream = client.stream({
        model: client.opusModel,
        systemPrompt: 's',
        userPrompt: 'Final question?',
        messages,
      });
      await collectStream(stream);

      const callArgs = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(callArgs[1].body as string);
      expect(body.messages).toHaveLength(4);
      expect(body.messages[0]).toEqual({ role: 'user', content: 'Who are you?' });
      expect(body.messages[1]).toEqual({ role: 'assistant', content: 'I am the GM.' });
      expect(body.messages[2]).toEqual({ role: 'user', content: 'Tell me more.' });
      expect(body.messages[3]).toEqual({ role: 'user', content: 'Final question?' });
    });

    it('works without messages (backward compatible)', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(sseEvent({ type: 'message_stop' })));
            controller.close();
          },
        })),
      );

      const stream = client.stream({ model: client.opusModel, systemPrompt: 's', userPrompt: 'u' });
      await collectStream(stream);

      const callArgs = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(callArgs[1].body as string);
      expect(body.messages).toHaveLength(1);
      expect(body.messages[0]).toEqual({ role: 'user', content: 'u' });
    });
  });

  describe('stream() — max_tokens defaults', () => {
    it('uses model-aware default max_tokens for Opus', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(sseEvent({ type: 'message_stop' })));
            controller.close();
          },
        })),
      );

      const stream = client.stream({ model: client.opusModel, systemPrompt: 's', userPrompt: 'u' });
      await collectStream(stream);

      const callArgs = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(callArgs[1].body as string);
      expect(body.max_tokens).toBe(40960);
    });

    it('uses model-aware default max_tokens for Sonnet', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(sseEvent({ type: 'message_stop' })));
            controller.close();
          },
        })),
      );

      const stream = client.stream({ model: client.sonnetModel, systemPrompt: 's', userPrompt: 'u' });
      await collectStream(stream);

      const callArgs = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(callArgs[1].body as string);
      expect(body.max_tokens).toBe(5120);
    });

    it('uses model-aware default max_tokens for Haiku', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(sseEvent({ type: 'message_stop' })));
            controller.close();
          },
        })),
      );

      const stream = client.stream({ model: client.haikuModel, systemPrompt: 's', userPrompt: 'u' });
      await collectStream(stream);

      const callArgs = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(callArgs[1].body as string);
      expect(body.max_tokens).toBe(512);
    });
  });

  describe('stream() — env var override', () => {
    it('uses env override LLM_MAX_TOKENS_OPUS when set', async () => {
      const clientWithOverride = new LLMClient(
        createMockConfig({ llmMaxTokensOpus: 80000 }),
      );
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(sseEvent({ type: 'message_stop' })));
            controller.close();
          },
        })),
      );

      const stream = clientWithOverride.stream({
        model: clientWithOverride.opusModel,
        systemPrompt: 's',
        userPrompt: 'u',
      });
      await collectStream(stream);

      const callArgs = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(callArgs[1].body as string);
      expect(body.max_tokens).toBe(80000);
    });
  });
});
