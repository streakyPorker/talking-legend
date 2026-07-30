import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LLMClient, StreamChunk } from './client';
import { ConfigService } from '../config/config.service';
import Anthropic from '@anthropic-ai/sdk';

// ── Mock @anthropic-ai/sdk ────────────────────────────────────────────────

vi.mock('@anthropic-ai/sdk', () => {
  const MockAnthropic = vi.fn(() => ({
    messages: {
      create: vi.fn(),
      stream: vi.fn(),
    },
  }));
  return { default: MockAnthropic };
});

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

/** Shape of the mock MessageStream returned by createMockMessageStream */
interface MockMessageStream {
  on: (event: string, cb: (...args: unknown[]) => void) => MockMessageStream;
  readonly ended: boolean;
  finalMessage: ReturnType<typeof vi.fn>;
  _emit: (event: string, ...args: unknown[]) => void;
}

function createMockMessageStream(
  overrides: {
    textDeltas?: string[];
    contentBlocks?: Array<{ type: string; name?: string; id?: string; input?: Record<string, unknown> }>;
    inputJsonEvents?: Array<{ partialJson: string; jsonSnapshot: unknown }>;
    finalMessage?: { content: Array<{ type: string; name?: string; id?: string; text?: string; input?: Record<string, unknown> }>; usage: { input_tokens: number; output_tokens: number } };
    ended?: boolean;
    error?: Error;
  } = {},
): MockMessageStream {
  const {
    finalMessage = {
      content: [{ type: 'text', text: 'response text' }],
      usage: { input_tokens: 100, output_tokens: 200 },
    },
    ended = true,
    error,
  } = overrides;

  const _ended = ended;

  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {
    text: [],
    contentBlock: [],
    inputJson: [],
    error: [],
    end: [],
  };

  let isEnded = _ended;

  const onFn = vi.fn((event: string, cb: (...args: unknown[]) => void) => {
    if (listeners[event]) {
      listeners[event].push(cb);
    }
    return mockStream;
  });

  const mockStream: MockMessageStream = {
    on: onFn,
    get ended() {
      return isEnded;
    },
    finalMessage: vi.fn().mockResolvedValue(finalMessage),
    // Helper to manually fire events
    _emit: (event: string, ...args: unknown[]) => {
      if (event === 'end') { isEnded = true; }
      (listeners[event] ?? []).forEach((cb) => cb(...args));
    },
  };

  return mockStream;
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
    vi.clearAllMocks();
    client = new LLMClient(createMockConfig());
  });

  describe('constructor / model getters', () => {
    it('creates an Anthropic client with the correct apiKey and baseURL', () => {
      const MockAnthropic = vi.mocked(Anthropic);
      expect(MockAnthropic).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: 'test-api-key',
          baseURL: 'https://api.anthropic.com',
          maxRetries: 0,
        }),
      );
    });

    it('returns opusModel from config', () => {
      expect(client.opusModel).toBe('claude-opus-4-8');
    });

    it('returns sonnetModel from config', () => {
      expect(client.sonnetModel).toBe('claude-sonnet-4-6');
    });

    it('returns haikuModel from config', () => {
      expect(client.haikuModel).toBe('claude-haiku-4-5-20251001');
    });
  });

  describe('call() — non-streaming', () => {
    it('returns content and usage from the SDK response', async () => {
      // Arrange: mock create to return a message
      const mockMessages = (client as any).anthropic.messages;
      mockMessages.create.mockResolvedValue({
        id: 'msg_123',
        content: [
          { type: 'text', text: 'Hello from Claude!' },
        ],
        usage: { input_tokens: 50, output_tokens: 30 },
      });

      // Act
      const result = await client.call({
        systemPrompt: 'Be helpful',
        userPrompt: 'Say hi',
      });

      // Assert
      expect(result.content).toBe('Hello from Claude!');
      expect(result.usage.inputTokens).toBe(50);
      expect(result.usage.outputTokens).toBe(30);
    });

    it('calls messages.create with correct params', async () => {
      const mockMessages = (client as any).anthropic.messages;
      mockMessages.create.mockResolvedValue({
        id: 'msg_1',
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 1, output_tokens: 1 },
      });

      await client.call({
        systemPrompt: 'You are GM',
        userPrompt: 'Start the story',
        maxTokens: 2000,
        temperature: 0.9,
      });

      expect(mockMessages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-sonnet-4-6',
          system: 'You are GM',
          messages: [{ role: 'user', content: 'Start the story' }],
          max_tokens: 2000,
          temperature: 0.9,
        }),
        expect.objectContaining({ signal: expect.any(Object) }),
      );
    });

    it('retries on failure and falls back gracefully', async () => {
      const mockMessages = (client as any).anthropic.messages;
      mockMessages.create.mockRejectedValue(new Error('API error'));

      // Use fake timers to skip the exponential backoff delays
      vi.useFakeTimers();

      // Start the call (will pause on retry backoffs)
      const resultPromise = client.call({
        systemPrompt: 's',
        userPrompt: 'u',
      });

      // Fast-forward through all retry delays (1s + 2s + 4s = 7s)
      // Also need to account for the AbortController timeout (30s)
      await vi.advanceTimersByTimeAsync(45000);

      // Now the call should have completed with fallback
      const result = await resultPromise;

      vi.useRealTimers();

      // Should have been called multiple times (initial + retries)
      expect(mockMessages.create.mock.calls.length).toBeGreaterThan(1);
      // Should fall back to placeholder
      expect(result.content).toBe('The world holds its breath, awaiting the next chapter...');
      expect(result.usage.inputTokens).toBe(0);
    });
  });

  describe('stream() — thinking support', () => {
    it('includes thinking param in SDK call when default budget > 0 (Opus)', async () => {
      const mockMessages = (client as any).anthropic.messages;
      const mockStream = createMockMessageStream();
      mockMessages.stream.mockReturnValue(mockStream);

      const stream = client.stream({ model: client.opusModel, systemPrompt: 's', userPrompt: 'u' });
      // Fire events that signal stream end before finalMessage
      mockStream._emit('end');

      await collectStream(stream);

      expect(mockMessages.stream).toHaveBeenCalledWith(
        expect.objectContaining({
          thinking: { type: 'enabled', budget_tokens: 4096 },
        }),
        expect.any(Object), // request options (timeout)
      );
    });

    it('omits thinking param when thinkingBudget is 0', async () => {
      const mockMessages = (client as any).anthropic.messages;
      const mockStream = createMockMessageStream();
      mockMessages.stream.mockReturnValue(mockStream);

      const stream = client.stream({
        model: client.opusModel,
        systemPrompt: 's',
        userPrompt: 'u',
        thinkingBudget: 0,
      });
      mockStream._emit('end');
      await collectStream(stream);

      const callArg = mockMessages.stream.mock.calls[0][0];
      expect(callArg).not.toHaveProperty('thinking');
    });

    it('uses Haiku default thinking budget of 0', async () => {
      const mockMessages = (client as any).anthropic.messages;
      const mockStream = createMockMessageStream();
      mockMessages.stream.mockReturnValue(mockStream);

      const stream = client.stream({ model: client.haikuModel, systemPrompt: 's', userPrompt: 'u' });
      mockStream._emit('end');
      await collectStream(stream);

      const callArg = mockMessages.stream.mock.calls[0][0];
      expect(callArg).not.toHaveProperty('thinking');
    });

    it('does NOT yield chunks for thinking content blocks (only text chunks)', async () => {
      const mockMessages = (client as any).anthropic.messages;
      const mockStream = createMockMessageStream({
        ended: false, // Must be false initially so drain loop waits for events
        finalMessage: {
          content: [
            { type: 'thinking', text: 'Hmm...' }, // thinking block (not yielded)
            { type: 'text', text: 'Hello world' }, // text block (usage only, content from text event)
          ],
          usage: { input_tokens: 10, output_tokens: 20 },
        },
      });
      mockMessages.stream.mockReturnValue(mockStream);

      const stream = client.stream({ model: client.opusModel, systemPrompt: 's', userPrompt: 'u' });
      // Fire text events asynchronously after iterator starts
      setTimeout(() => {
        mockStream._emit('text', 'Hello world');
        mockStream._emit('end');
      }, 0);

      const chunks = await collectStream(stream);

      // Only the text 'Hello world' should appear as a chunk
      const contentChunks = chunks.filter((c) => c.type === 'chunk');
      expect(contentChunks).toHaveLength(1);
      expect(contentChunks[0]).toEqual({ type: 'chunk', content: 'Hello world' });
    });
  });

  describe('stream() — messages concatenation', () => {
    it('prepends history messages before user prompt', async () => {
      const mockMessages = (client as any).anthropic.messages;
      const mockStream = createMockMessageStream();
      mockMessages.stream.mockReturnValue(mockStream);

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
      mockStream._emit('end');
      await collectStream(stream);

      const callArg = mockMessages.stream.mock.calls[0][0];
      expect(callArg.messages).toHaveLength(4);
      expect(callArg.messages[0]).toEqual({ role: 'user', content: 'Who are you?' });
      expect(callArg.messages[1]).toEqual({ role: 'assistant', content: 'I am the GM.' });
      expect(callArg.messages[2]).toEqual({ role: 'user', content: 'Tell me more.' });
      expect(callArg.messages[3]).toEqual({ role: 'user', content: 'Final question?' });
    });

    it('works without messages (backward compatible)', async () => {
      const mockMessages = (client as any).anthropic.messages;
      const mockStream = createMockMessageStream();
      mockMessages.stream.mockReturnValue(mockStream);

      const stream = client.stream({ model: client.opusModel, systemPrompt: 's', userPrompt: 'u' });
      mockStream._emit('end');
      await collectStream(stream);

      const callArg = mockMessages.stream.mock.calls[0][0];
      expect(callArg.messages).toHaveLength(1);
      expect(callArg.messages[0]).toEqual({ role: 'user', content: 'u' });
    });
  });

  describe('stream() — max_tokens defaults', () => {
    it('uses model-aware default max_tokens for Opus', async () => {
      const mockMessages = (client as any).anthropic.messages;
      const mockStream = createMockMessageStream();
      mockMessages.stream.mockReturnValue(mockStream);

      const stream = client.stream({ model: client.opusModel, systemPrompt: 's', userPrompt: 'u' });
      mockStream._emit('end');
      await collectStream(stream);

      const callArg = mockMessages.stream.mock.calls[0][0];
      expect(callArg.max_tokens).toBe(40960);
    });

    it('uses model-aware default max_tokens for Sonnet', async () => {
      const mockMessages = (client as any).anthropic.messages;
      const mockStream = createMockMessageStream();
      mockMessages.stream.mockReturnValue(mockStream);

      const stream = client.stream({ model: client.sonnetModel, systemPrompt: 's', userPrompt: 'u' });
      mockStream._emit('end');
      await collectStream(stream);

      const callArg = mockMessages.stream.mock.calls[0][0];
      expect(callArg.max_tokens).toBe(5120);
    });

    it('uses model-aware default max_tokens for Haiku', async () => {
      const mockMessages = (client as any).anthropic.messages;
      const mockStream = createMockMessageStream();
      mockMessages.stream.mockReturnValue(mockStream);

      const stream = client.stream({ model: client.haikuModel, systemPrompt: 's', userPrompt: 'u' });
      mockStream._emit('end');
      await collectStream(stream);

      const callArg = mockMessages.stream.mock.calls[0][0];
      expect(callArg.max_tokens).toBe(512);
    });
  });

  describe('stream() — env var override', () => {
    it('uses env override LLM_MAX_TOKENS_OPUS when set', async () => {
      const clientWithOverride = new LLMClient(
        createMockConfig({ llmMaxTokensOpus: 80000 }),
      );
      const mockMessages = (clientWithOverride as any).anthropic.messages;
      const mockStream = createMockMessageStream();
      mockMessages.stream.mockReturnValue(mockStream);

      const stream = clientWithOverride.stream({
        model: clientWithOverride.opusModel,
        systemPrompt: 's',
        userPrompt: 'u',
      });
      mockStream._emit('end');
      await collectStream(stream);

      const callArg = mockMessages.stream.mock.calls[0][0];
      expect(callArg.max_tokens).toBe(80000);
    });
  });

  describe('stream() — tool_use support', () => {
    it('yields tool_use chunks from finalMessage content', async () => {
      const mockMessages = (client as any).anthropic.messages;
      const mockStream = createMockMessageStream({
        textDeltas: [],
        finalMessage: {
          content: [
            { type: 'tool_use', name: 'move_to', id: 'toolu_abc', input: { region: 'forest' } },
          ],
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      });
      mockMessages.stream.mockReturnValue(mockStream);

      const stream = client.stream({
        model: client.opusModel,
        systemPrompt: 's',
        userPrompt: 'go to forest',
        tools: [{ name: 'move_to', description: 'Move to region', input_schema: { type: 'object', properties: {} } }],
      });
      // Fire end to trigger drain completion and finalMessage
      mockStream._emit('end');

      const chunks = await collectStream(stream);
      const toolUseChunks = chunks.filter((c) => c.type === 'tool_use');
      expect(toolUseChunks).toHaveLength(1);
      expect(toolUseChunks[0]).toEqual({
        type: 'tool_use',
        name: 'move_to',
        id: 'toolu_abc',
        input: { region: 'forest' },
      });
    });

    it('yields usage chunks after stream completion', async () => {
      const mockMessages = (client as any).anthropic.messages;
      const mockStream = createMockMessageStream({
        finalMessage: {
          content: [{ type: 'text', text: 'done' }],
          usage: { input_tokens: 50, output_tokens: 100 },
        },
      });
      mockMessages.stream.mockReturnValue(mockStream);

      const stream = client.stream({ model: client.opusModel, systemPrompt: 's', userPrompt: 'u' });
      mockStream._emit('text', 'done');
      mockStream._emit('end');

      const chunks = await collectStream(stream);
      const usageChunk = chunks.find((c) => c.type === 'usage') as StreamChunk & { type: 'usage' };
      expect(usageChunk).toBeDefined();
      expect(usageChunk!.inputTokens).toBe(50);
      expect(usageChunk!.outputTokens).toBe(100);
    });
  });

  describe('stream() — tools param forwarding', () => {
    it('passes tools to the SDK when options.tools is provided', async () => {
      const mockMessages = (client as any).anthropic.messages;
      const mockStream = createMockMessageStream();
      mockMessages.stream.mockReturnValue(mockStream);

      const tools = [
        { name: 'move_to', description: 'Move to a region', input_schema: { type: 'object', properties: {} } },
      ];

      const stream = client.stream({
        model: client.opusModel,
        systemPrompt: 's',
        userPrompt: 'go',
        tools,
      });
      mockStream._emit('end');
      await collectStream(stream);

      const callArg = mockMessages.stream.mock.calls[0][0];
      expect(callArg.tools).toBeDefined();
      expect(callArg.tools).toHaveLength(1);
      expect(callArg.tools[0].name).toBe('move_to');
    });

    it('omits tools when options.tools is undefined', async () => {
      const mockMessages = (client as any).anthropic.messages;
      const mockStream = createMockMessageStream();
      mockMessages.stream.mockReturnValue(mockStream);

      const stream = client.stream({ model: client.opusModel, systemPrompt: 's', userPrompt: 'u' });
      mockStream._emit('end');
      await collectStream(stream);

      const callArg = mockMessages.stream.mock.calls[0][0];
      expect(callArg).not.toHaveProperty('tools');
    });
  });
});
