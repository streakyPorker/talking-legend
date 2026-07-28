/**
 * RFC-005: GMEngine 单元测试。
 *
 * 手动 mock 所有依赖，不启动 NestJS 模块。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GMEngine, GMChunkEvent, GMDoneEvent } from './gm-engine';
import type { LLMClient, StreamChunk } from './client';
import type { TemplateEngine } from '../prompts/template-engine';
import type { AssembledContext } from '../context/context-module.interface';
import type { LlmLogRepository, LlmLogEntry } from '../db/repositories/llm-log.repository';
import type { NarrativeService } from '../game/narrative.service';
import type { ContextProvider } from '../game/context-provider';

// ─── Helpers ──────────────────────────────────────────────

function makeStreamChunks(text: string): StreamChunk[] {
  const chunks: StreamChunk[] = [];
  for (let i = 0; i < text.length; i += 10) {
    chunks.push({ type: 'chunk', content: text.slice(i, i + 10) });
  }
  chunks.push({ type: 'usage', inputTokens: 500, outputTokens: 150 });
  chunks.push({ type: 'stream_end' });
  return chunks;
}

async function* chunksToAsyncIterable(chunks: StreamChunk[]): AsyncIterable<StreamChunk> {
  for (const c of chunks) {
    yield c;
  }
}

function buildMockContext(overrides?: Partial<AssembledContext>): AssembledContext {
  return {
    systemPrompt: 'You are a GM in a fantasy world.',
    userPrompt: '',
    tokenEstimate: 1200,
    ...overrides,
  };
}

function makeMockLlmClient(streamChunks?: StreamChunk[], shouldThrow?: boolean): LLMClient {
  return {
    opusModel: 'claude-opus-4-8',
    stream: vi.fn().mockImplementation(async function* () {
      if (shouldThrow) {
        throw new Error('LLM unavailable');
      }
      yield* chunksToAsyncIterable(streamChunks ?? []);
    }),
  } as unknown as LLMClient;
}

function makeMockTemplateEngine(): TemplateEngine {
  return {
    render: vi.fn().mockReturnValue('玩家行动：look\n目标：无\n\n请生成 GM 叙事。\n'),
  } as unknown as TemplateEngine;
}

function makeMockContextProvider(assembled: AssembledContext): ContextProvider {
  return {
    buildGMContext: vi.fn().mockResolvedValue(assembled),
  } as unknown as ContextProvider;
}

function makeMockLlmLogRepo(): LlmLogRepository {
  return {
    insert: vi.fn().mockReturnValue(1),
  } as unknown as LlmLogRepository;
}

function makeMockNarrativeService(): NarrativeService {
  return {
    append: vi.fn(),
  } as unknown as NarrativeService;
}

// ─── Tests ────────────────────────────────────────────────

describe('GMEngine', () => {
  let engine: GMEngine;
  let mockLlmClient: LLMClient;
  let mockTemplateEngine: TemplateEngine;
  let mockContextProvider: ContextProvider;
  let mockLlmLogRepo: LlmLogRepository;
  let mockNarrativeService: NarrativeService;

  beforeEach(() => {
    mockLlmClient = makeMockLlmClient();
    mockTemplateEngine = makeMockTemplateEngine();
    mockContextProvider = makeMockContextProvider(buildMockContext());
    mockLlmLogRepo = makeMockLlmLogRepo();
    mockNarrativeService = makeMockNarrativeService();

    engine = new GMEngine(
      mockLlmClient,
      mockTemplateEngine,
      mockContextProvider,
      mockLlmLogRepo,
      mockNarrativeService,
    );
  });

  // ─── Test 1: 正常流 — 验证 yield chunk + done ─────────────────

  it('generate 正常流：逐 chunk 输出并最终 yield done', async () => {
    const text = '你环顾四周，古老的枫树在微风中沙沙作响。';
    mockLlmClient = makeMockLlmClient(makeStreamChunks(text));
    engine = new GMEngine(
      mockLlmClient,
      mockTemplateEngine,
      mockContextProvider,
      mockLlmLogRepo,
      mockNarrativeService,
    );

    const events: Array<{ type: string; content?: string }> = [];
    for await (const event of engine.generate('game-1', 'look', undefined, 1)) {
      events.push(event);
      if (event.type === 'chunk') {
        expect(event.content).toBeDefined();
      }
    }

    // 最后一个事件应为 done
    expect(events.length).toBeGreaterThan(0);
    const done = events[events.length - 1];
    expect(done.type).toBe('done');
    expect((done as GMDoneEvent).turn).toBe(1);

    // 收集的 chunk 内容应拼接为完整文本
    const fullText = events
      .filter((e): e is GMChunkEvent => e.type === 'chunk')
      .map((e) => e.content)
      .join('');
    expect(fullText).toBe(text);
  });

  // ─── Test 2: 降级 — LLMClient.stream 抛错 → yield fallback chunk + done ─

  it('generate 降级：LLM 不可用时 yield fallback 文本', async () => {
    mockLlmClient = makeMockLlmClient(undefined, true);
    engine = new GMEngine(
      mockLlmClient,
      mockTemplateEngine,
      mockContextProvider,
      mockLlmLogRepo,
      mockNarrativeService,
    );

    const events: Array<{ type: string; content?: string }> = [];
    for await (const event of engine.generate('game-1', 'attack', 'goblin', 2)) {
      events.push(event);
    }

    const chunks = events.filter((e): e is GMChunkEvent => e.type === 'chunk');
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].content).toContain('attack');

    const done = events.find((e): e is GMDoneEvent => e.type === 'done');
    expect(done).toBeDefined();
    expect((done as GMDoneEvent).turn).toBe(2);
  });

  // ─── Test 3: done 事件包含 turn ────────────────────────────

  it('done 事件包含正确的 turn', async () => {
    for await (const event of engine.generate('game-1', 'look', undefined, 5)) {
      if (event.type === 'done') {
        expect(event.turn).toBe(5);
      }
    }
  });

  // ─── Test 4: done 事件包含 tokenEstimate ───────────────────

  it('done 事件包含上下文 token 估算', async () => {
    for await (const event of engine.generate('game-1', 'look', undefined, 3)) {
      if (event.type === 'done') {
        expect(event.tokenEstimate).toBe(1200);
      }
    }
  });

  // ─── Test 5: llmLogRepo.insert 被调用 ──────────────────────

  it('日志记录：llmLogRepo.insert 被调用', async () => {
    const text = '森林深处传来一声低吼。';
    mockLlmClient = makeMockLlmClient(makeStreamChunks(text));
    engine = new GMEngine(
      mockLlmClient,
      mockTemplateEngine,
      mockContextProvider,
      mockLlmLogRepo,
      mockNarrativeService,
    );

    const events: Array<{ type: string }> = [];
    for await (const event of engine.generate('game-1', 'listen', undefined, 2)) {
      events.push(event);
    }

    expect(events.some((e) => e.type === 'done')).toBe(true);
    expect(mockLlmLogRepo.insert).toHaveBeenCalledOnce();
    const callArg = (mockLlmLogRepo.insert as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArg.gameId).toBe('game-1');
    expect(callArg.callType).toBe('gm_narrative');
    expect(callArg.model).toBe('claude-opus-4-8');
    expect(callArg.promptTokens).toBe(500);
    expect(callArg.completionTokens).toBe(150);
    expect(callArg.latencyMs).toBeGreaterThanOrEqual(0);
    expect(callArg.costUsd).toBe(0);
  });

  // ─── Test 6: narrativeService.append 被调用 ────────────────

  it('叙事持久化：narrativeService.append 被调用', async () => {
    const text = '你推开了厚重的橡木门。';
    mockLlmClient = makeMockLlmClient(makeStreamChunks(text));
    engine = new GMEngine(
      mockLlmClient,
      mockTemplateEngine,
      mockContextProvider,
      mockLlmLogRepo,
      mockNarrativeService,
    );

    const events: Array<{ type: string }> = [];
    for await (const event of engine.generate('game-1', 'open door', undefined, 3)) {
      events.push(event);
    }

    expect(events.some((e) => e.type === 'done')).toBe(true);
    expect(mockNarrativeService.append).toHaveBeenCalledOnce();
    expect(mockNarrativeService.append).toHaveBeenCalledWith('game-1', 3, text);
  });

  // ─── Test 7: fallbackNarrative 包含 action 文本 ─────────────

  it('降级文本包含玩家 action', async () => {
    mockLlmClient = makeMockLlmClient(undefined, true);
    engine = new GMEngine(
      mockLlmClient,
      mockTemplateEngine,
      mockContextProvider,
      mockLlmLogRepo,
      mockNarrativeService,
    );

    const chunks: string[] = [];
    for await (const event of engine.generate('game-1', 'meditate', undefined, 1)) {
      if (event.type === 'chunk') {
        chunks.push(event.content);
      }
    }

    const fallback = chunks.join('');
    expect(fallback).toContain('meditate');
    expect(fallback).toContain('世界屏息凝神');
  });

  // ─── Test 8: target undefined 时 userParams.target = '无' ───

  it('target 为 undefined 时模板渲染用 "无" 填充', async () => {
    for await (const event of engine.generate('game-1', 'look', undefined, 1)) {
      if (event.type === 'done') break;
    }

    expect(mockTemplateEngine.render).toHaveBeenCalledOnce();
    const params = (mockTemplateEngine.render as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(params.target).toBe('无');
  });

  // ─── Test 9: target 有值时原样传递 ──────────────────────────

  it('target 有值时原样传给模板引擎', async () => {
    for await (const event of engine.generate('game-1', 'talk', '老铁匠王二', 1)) {
      if (event.type === 'done') break;
    }

    const params = (mockTemplateEngine.render as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(params.target).toBe('老铁匠王二');
    expect(params.playerAction).toBe('talk');
  });

  // ─── Test 10: 上下文构建失败 → 降级并 done ──────────────────

  it('上下文构建失败时降级并返回 done', async () => {
    const failingCtxProvider = {
      buildGMContext: vi.fn().mockRejectedValue(new Error('context build failed')),
    } as unknown as ContextProvider;

    engine = new GMEngine(
      mockLlmClient,
      mockTemplateEngine,
      failingCtxProvider,
      mockLlmLogRepo,
      mockNarrativeService,
    );

    const events: Array<{ type: string; content?: string }> = [];
    for await (const event of engine.generate('game-1', 'look', undefined, 1)) {
      events.push(event);
    }

    const chunks = events.filter((e): e is GMChunkEvent => e.type === 'chunk');
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].content).toContain('look');

    const done = events.find((e): e is GMDoneEvent => e.type === 'done');
    expect(done).toBeDefined();
    // tokenEstimate 应为 0（未获得上下文）
    expect((done as GMDoneEvent).tokenEstimate).toBe(0);
  });
});
