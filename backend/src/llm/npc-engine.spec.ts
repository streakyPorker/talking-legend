/**
 * RFC-006: NpcEngine 单元测试。
 *
 * 手动 mock 所有依赖，不启动 NestJS 模块。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NpcEngine } from './npc-engine';
import type { LLMClient, StreamChunk } from './client';
import type { AssembledContext } from '../context/context-module.interface';
import type { LlmLogRepository } from '../db/repositories/llm-log.repository';
import type { NpcRepository } from '../db/repositories/npc.repository';
import type { ContextProvider } from '../game/context-provider';
import type { NpcChunkEvent, NpcDoneEvent } from './npc-engine';
import type { NPCState } from '@talking-legend/shared';

// ─── Helpers ──────────────────────────────────────────────

function makeStreamChunks(text: string, hasUsage = true): StreamChunk[] {
  const chunks: StreamChunk[] = [];
  for (let i = 0; i < text.length; i += 10) {
    chunks.push({ type: 'chunk', content: text.slice(i, i + 10) });
  }
  if (hasUsage) {
    chunks.push({ type: 'usage', inputTokens: 800, outputTokens: 120 });
  }
  chunks.push({ type: 'stream_end' });
  return chunks;
}

async function* chunksToAsyncIterable(
  chunks: StreamChunk[],
): AsyncIterable<StreamChunk> {
  for (const c of chunks) {
    yield c;
  }
}

function buildMockContext(
  overrides?: Partial<AssembledContext>,
): AssembledContext {
  return {
    systemPrompt: 'You are an NPC in a fantasy village.',
    userPrompt: '',
    tokenEstimate: 2000,
    ...overrides,
  };
}

function makeMockLlmClient(
  streamChunks?: StreamChunk[],
  shouldThrow?: boolean,
): LLMClient {
  return {
    sonnetModel: 'claude-sonnet-4-6',
    stream: vi.fn().mockImplementation(async function* () {
      if (shouldThrow) {
        throw new Error('LLM unavailable');
      }
      yield* chunksToAsyncIterable(streamChunks ?? []);
    }),
  } as unknown as LLMClient;
}

function makeMockContextProvider(
  assembled?: AssembledContext,
  shouldThrow?: boolean,
): ContextProvider {
  return {
    buildNpcContext: vi.fn().mockImplementation(async () => {
      if (shouldThrow) {
        throw new Error('context build failed');
      }
      return assembled ?? buildMockContext();
    }),
  } as unknown as ContextProvider;
}

function makeMockLlmLogRepo(): LlmLogRepository {
  return {
    insert: vi.fn().mockReturnValue(1),
  } as unknown as LlmLogRepository;
}

function makeMockNpcRepo(): NpcRepository {
  return {
    addMemory: vi.fn(),
    update: vi.fn(),
  } as unknown as NpcRepository;
}

function makeSampleNpc(overrides?: Partial<NPCState>): NPCState {
  return {
    id: 'npc-1',
    name: '老铁匠',
    role: '铁匠',
    personality: '温和而沉默',
    currentMood: '平静',
    location: 'village',
    memoryOfPlayer: [],
    isAlive: true,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────

describe('NpcEngine', () => {
  let engine: NpcEngine;
  let mockLlmClient: LLMClient;
  let mockContextProvider: ContextProvider;
  let mockLlmLogRepo: LlmLogRepository;
  let mockNpcRepo: NpcRepository;
  let sampleNpc: NPCState;

  beforeEach(() => {
    mockLlmClient = makeMockLlmClient();
    mockContextProvider = makeMockContextProvider();
    mockLlmLogRepo = makeMockLlmLogRepo();
    mockNpcRepo = makeMockNpcRepo();
    sampleNpc = makeSampleNpc();

    engine = new NpcEngine(
      mockLlmClient,
      mockContextProvider,
      mockLlmLogRepo,
      mockNpcRepo,
    );
  });

  // ─── Test 1: 正常流 — 逐 chunk 输出并最终 yield done ─────────

  it('generate 正常流：逐 chunk 输出并最终 yield done', async () => {
    const text = '年轻人，这把剑是上好的精铁打造的。';
    mockLlmClient = makeMockLlmClient(makeStreamChunks(text));
    engine = new NpcEngine(
      mockLlmClient,
      mockContextProvider,
      mockLlmLogRepo,
      mockNpcRepo,
    );

    const events: Array<{ type: string; content?: string }> = [];
    for await (const event of engine.generate(
      'game-1',
      sampleNpc,
      '我需要一把好剑',
      '旅人',
      [],
    )) {
      events.push(event);
      if (event.type === 'chunk') {
        expect(event.content).toBeDefined();
      }
    }

    expect(events.length).toBeGreaterThan(0);
    const done = events[events.length - 1];
    expect(done.type).toBe('done');
    expect((done as NpcDoneEvent).turn).toBe(-1);

    const fullText = events
      .filter((e): e is NpcChunkEvent => e.type === 'chunk')
      .map((e) => e.content)
      .join('');
    expect(fullText).toBe(text);
  });

  // ─── Test 2: 降级 — LLMClient.stream 抛错 → fallbackDialogue ──

  it('generate 降级：LLM 不可用时 fallback 文本', async () => {
    mockLlmClient = makeMockLlmClient(undefined, true);
    engine = new NpcEngine(
      mockLlmClient,
      mockContextProvider,
      mockLlmLogRepo,
      mockNpcRepo,
    );

    const events: Array<{ type: string; content?: string }> = [];
    for await (const event of engine.generate(
      'game-1',
      sampleNpc,
      '你好吗？',
      '旅人',
      [],
    )) {
      events.push(event);
    }

    const chunks = events.filter((e): e is NpcChunkEvent => e.type === 'chunk');
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].content).toContain('老铁匠');
    expect(chunks[0].content).toContain('沉默');
  });

  // ─── Test 4: 情绪更新 — 含 [mood: xxx] 标记 → npcRepo.update ─

  it('情绪更新：回复含 [mood: 愤怒] 时 npcRepo.update 被调用', async () => {
    const text = '你竟敢提那件事！[mood: 愤怒]';
    mockLlmClient = makeMockLlmClient(makeStreamChunks(text));
    engine = new NpcEngine(
      mockLlmClient,
      mockContextProvider,
      mockLlmLogRepo,
      mockNpcRepo,
    );

    for await (const _event of engine.generate(
      'game-1',
      sampleNpc,
      '说说你的往事',
      '旅人',
      [],
    )) {
      /* drain */
    }

    expect(mockNpcRepo.update).toHaveBeenCalledWith('npc-1', {
      currentMood: '愤怒',
    });
  });

  // ─── Test 5: 无 mood 标记 → npcRepo.update 不被调用 ──────────

  it('无 mood 标记时不更新情绪', async () => {
    const text = '那都是很久以前的事了。';
    mockLlmClient = makeMockLlmClient(makeStreamChunks(text));
    engine = new NpcEngine(
      mockLlmClient,
      mockContextProvider,
      mockLlmLogRepo,
      mockNpcRepo,
    );

    for await (const _event of engine.generate(
      'game-1',
      sampleNpc,
      '你的故事是什么？',
      '旅人',
      [],
    )) {
      /* drain */
    }

    // update 不会被情绪解析调用（可能被 memory 或别处调用 — 但 addMemory 才是 memory 写入）
    // memory 写入在 addMemory 中，不涉及 update。
    // 由于 addMemory 测试单独覆盖，这里只验证 update 不被调用
    expect(mockNpcRepo.update).not.toHaveBeenCalled();
  });

  // ─── Test 6: history 传入 LLMClient.userPrompt 中 ────────────

  it('history 消息拼入 userPrompt', async () => {
    mockLlmClient = makeMockLlmClient();
    engine = new NpcEngine(
      mockLlmClient,
      mockContextProvider,
      mockLlmLogRepo,
      mockNpcRepo,
    );

    const history: Array<{ role: 'user' | 'assistant'; content: string }> = [
      { role: 'user', content: '你是谁？' },
      { role: 'assistant', content: '我是村里的铁匠。' },
    ];

    for await (const _event of engine.generate(
      'game-1',
      sampleNpc,
      '你能帮我打一把剑吗？',
      '旅人',
      history,
    )) {
      /* drain */
    }

    expect(mockLlmClient.stream).toHaveBeenCalledOnce();
    const callArg = (mockLlmClient.stream as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    // user prompt 应包含历史 + 当前消息
    expect(callArg.userPrompt).toContain('旅人：你是谁？');
    expect(callArg.userPrompt).toContain('老铁匠：我是村里的铁匠。');
    expect(callArg.userPrompt).toContain('旅人：你能帮我打一把剑吗？');
  });

  // ─── Test 7: done 事件包含 tokenEstimate ────────────────────

  it('done 事件包含 tokenEstimate', async () => {
    let doneEvent: NpcDoneEvent | undefined;
    for await (const event of engine.generate(
      'game-1',
      sampleNpc,
      '你好',
      '旅人',
      [],
    )) {
      if (event.type === 'done') {
        doneEvent = event;
      }
    }

    expect(doneEvent).toBeDefined();
    expect(doneEvent!.tokenEstimate).toBe(2000);
  });

  // ─── Test 8: llmLogRepo.insert 被调用 ────────────────────────

  it('llmLogRepo.insert 被调用且参数正确', async () => {
    const text = '这把剑花了我三个月的时间。';
    mockLlmClient = makeMockLlmClient(makeStreamChunks(text));
    engine = new NpcEngine(
      mockLlmClient,
      mockContextProvider,
      mockLlmLogRepo,
      mockNpcRepo,
    );

    for await (const _event of engine.generate(
      'game-1',
      sampleNpc,
      '这剑花了多久？',
      '旅人',
      [],
    )) {
      /* drain */
    }

    expect(mockLlmLogRepo.insert).toHaveBeenCalledOnce();
    const callArg = (mockLlmLogRepo.insert as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(callArg.gameId).toBe('game-1');
    expect(callArg.callType).toBe('npc_dialogue');
    expect(callArg.model).toBe('claude-sonnet-4-6');
    expect(callArg.promptTokens).toBe(800);
    expect(callArg.completionTokens).toBe(120);
    expect(callArg.latencyMs).toBeGreaterThanOrEqual(0);
    expect(callArg.costUsd).toBe(0);
  });

  // ─── Test 9: temperature=0.9 传入 LLMClient ─────────────────

  it('LLMClient.stream 被调用时 temperature 为 0.9', async () => {
    for await (const _event of engine.generate(
      'game-1',
      sampleNpc,
      '给我讲讲这个村子',
      '旅人',
      [],
    )) {
      /* drain */
    }

    expect(mockLlmClient.stream).toHaveBeenCalledOnce();
    const callArg = (mockLlmClient.stream as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(callArg.temperature).toBe(0.9);
  });

  // ─── Test 10: Sonnet 模型被使用 ─────────────────────────────

  it('LLMClient.stream 使用 sonnetModel', async () => {
    for await (const _event of engine.generate(
      'game-1',
      sampleNpc,
      '你好',
      '旅人',
      [],
    )) {
      /* drain */
    }

    expect(mockLlmClient.stream).toHaveBeenCalledOnce();
    const callArg = (mockLlmClient.stream as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(callArg.model).toBe('claude-sonnet-4-6');
  });

  // ─── Test 11: addMemory 被调用（同步兜底）────────────────────

  it('addMemory 被调用：玩家消息作为记忆写入', async () => {
    for await (const _event of engine.generate(
      'game-1',
      sampleNpc,
      '我要买这把剑',
      '旅人',
      [],
    )) {
      /* drain */
    }

    expect(mockNpcRepo.addMemory).toHaveBeenCalledWith(
      'npc-1',
      '我要买这把剑',
      0,
    );
  });

  // ─── Test 12: 上下文构建失败 → 降级 + done 含 tokenEstimate=0 ──

  it('上下文构建失败时降级并返回 tokenEstimate=0', async () => {
    mockContextProvider = makeMockContextProvider(undefined, true);
    engine = new NpcEngine(
      mockLlmClient,
      mockContextProvider,
      mockLlmLogRepo,
      mockNpcRepo,
    );

    const events: Array<{ type: string; content?: string }> = [];
    for await (const event of engine.generate(
      'game-1',
      sampleNpc,
      '你好',
      '旅人',
      [],
    )) {
      events.push(event);
    }

    const chunks = events.filter((e): e is NpcChunkEvent => e.type === 'chunk');
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].content).toContain('老铁匠');

    const done = events.find((e): e is NpcDoneEvent => e.type === 'done');
    expect(done).toBeDefined();
    expect(done!.tokenEstimate).toBe(0);
  });
});
