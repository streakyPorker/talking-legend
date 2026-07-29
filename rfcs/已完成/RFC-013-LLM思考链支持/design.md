# RFC-013: LLM 思考链支持

> **状态**: 已完成
> **优先级**: P1
> **创建**: 2026-07-29
> **依赖**: RFC-005（LLMClient.stream）、RFC-006（NPC对话）、RFC-007（意图分类）

## 问题

当前 LLMClient 调用 Anthropic API 时不启用 extended thinking，模型直接输出结果。GM 叙事和 NPC 对话是复杂推理任务，模型需要"思考"才能生成更有深度和连贯性的内容。

## 设计决策

| # | 决策 | 结论 |
|---|------|------|
| D1 | 默认状态 | **默认开启**（thinking: enabled） |
| D2 | 模型策略 | Opus thinking=4096/max=40960, Sonnet thinking=2048/max=5120, Haiku=0 |
| D3 | 可配置 | 全部通过环境变量调节（`LLM_MAX_TOKENS_*`, `LLM_THINKING_*`） |
| D4 | 流式处理 | thinking 内容**不发送给前端**，仅在 LLMClient 内部消费 |
| D5 | 默认值 | 比原值扩大 5 倍（Opus 40K, Sonnet 5K），支持长篇叙事和深度角色扮演 |

## 实现

### 1. LLMClient 改造

`LLMCallOptions` 新增字段：

```typescript
interface LLMCallOptions {
  systemPrompt: string;
  userPrompt: string;
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>;  // 历史消息(NPC多轮)
  temperature?: number;
  maxTokens?: number;
  thinkingBudget?: number;  // 0 = 关闭
}
```

`stream()` 方法改造：

```typescript
async *stream(options: LLMCallOptions): AsyncIterable<StreamChunk> {
  const thinkingBudget = options.thinkingBudget ?? this.defaultThinkingBudget();
  const thinking = thinkingBudget > 0
    ? { type: 'enabled' as const, budget_tokens: thinkingBudget }
    : undefined;

  const response = await fetch(`${baseUrl}/v1/messages`, {
    body: JSON.stringify({
      model,
      system: options.systemPrompt,
      messages: [
        ...(options.messages ?? []),
        { role: 'user', content: options.userPrompt },
      ],
      max_tokens: options.maxTokens ?? this.getMaxTokens(model),
      temperature: options.temperature ?? 0.7,
      thinking,
      stream: true,
    }),
  });

  // SSE 解析
  for (const line of lines) {
    switch (data.type) {
      case 'content_block_start':
        // thinking block → 标记但不出
        break;
      case 'content_block_delta':
        if (data.delta?.type === 'text_delta') {
          yield { type: 'chunk', content: data.delta.text };
        }
        // thinking_delta: 接收但不 yield
        break;
      // ... message_delta, message_stop, error 不变
    }
  }
}
```

`defaultThinkingBudget()` 按模型：
- Opus: `this.config.llmThinkingOpus`（默认 4096）
- Sonnet: `this.config.llmThinkingSonnet`（默认 2048）
- Haiku: 0

### 2. 调用点无需改动

GMEngine/NpcEngine 不传 `thinkingBudget` 时使用默认值。如需关闭，传 `thinkingBudget: 0`。

### 3. max_tokens（5x + 可配）

| 模型 | 新默认 | thinking | 净输出 | 环境变量 |
|------|--------|----------|--------|----------|
| Opus | 40960 | 4096 | 36864 | `LLM_MAX_TOKENS_OPUS` |
| Sonnet | 5120 | 2048 | 3072 | `LLM_MAX_TOKENS_SONNET` |
| Haiku | 512 | 0 | 512 | `LLM_MAX_TOKENS_HAIKU` |

### 4. 测试策略

| 测试 | 内容 |
|------|------|
| `stream() thinking 默认开启` | mock fetch，验证 body 含 `thinking: { type: "enabled", budget_tokens: 4096 }` |
| `stream() 可关闭` | `thinkingBudget: 0` → body 不含 thinking 字段 |
| `thinking_delta 不产出 chunk` | mock 返回 thinking_delta → AsyncIterable 无 yield |
| `messages[] 拼接` | 传入 3 条历史 → fetch body 的 messages 数组前 3 条为历史 |
| `maxTokens 默认值按模型` | 不传 maxTokens → Opus=40960, Sonnet=5120 |
| `环境变量覆盖` | `LLM_MAX_TOKENS_OPUS=80000` → maxTokens=80000 |

### 文件变更

```
backend/src/llm/client.ts  🔧 stream(): thinking + messages[] + 5x + 环境变量
backend/src/llm/client.spec.ts  🔧 新增 6 个 thinking/messages/maxTokens 测试
```

### 非目标

- ❌ 前端展示思考过程
- ❌ Haiku thinking（不支持）
- ❌ 非 Anthropic provider 兼容
