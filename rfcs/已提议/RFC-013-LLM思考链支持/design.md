# RFC-013: LLM 思考链支持

> **状态**: 设计中
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

`stream()` 方法的 fetch body 新增 `thinking` 参数：

```typescript
async *stream(options: LLMCallOptions & { maxTokens?: number; thinkingBudget?: number }) {
  const thinking = options.thinkingBudget !== undefined
    ? { type: 'enabled' as const, budget_tokens: options.thinkingBudget }
    : { type: 'enabled' as const, budget_tokens: this.defaultThinkingBudget() };

  body: JSON.stringify({
    model,
    system: options.systemPrompt,
    messages: [...],
    max_tokens: options.maxTokens ?? 8192,
    thinking,  // ← 新增
    stream: true,
  });
}
```

`defaultThinkingBudget()` 按模型：
- Sonnet: 2048
- Opus: 4096

**流式解析**：新增 `thinking_delta` 处理 — 接收但不 yield（前端不展示思考过程）。

### 2. 调用点调整

| 调用方 | 模型 | thinking budget | 说明 |
|--------|------|-----------------|------|
| GMEngine | Opus | 4096（默认） | GM 叙事需深度推理 |
| NpcEngine | Sonnet | 2048（默认） | NPC 角色一致性推理 |
| 意图分类(RFC-007) | Haiku | 0 | 简单分类不需要 |

各 NpcEngine/GMEngine 无需改代码，LLMClient 内置默认值。

### 3. max_tokens 调整（5x + 可配置）

| 模型 | maxTokens（原） | maxTokens（新） | thinking budget | 输出预算 | 环境变量 |
|------|----------------|-----------------|-----------------|----------|----------|
| Opus (GMEngine) | 8192 | **40960** | 4096 | 36864 | `LLM_MAX_TOKENS_OPUS` |
| Sonnet (NpcEngine) | 1024 | **5120** | 2048 | 3072 | `LLM_MAX_TOKENS_SONNET` |
| Haiku (RFC-007) | 512 | 512 | 0 | 512 | `LLM_MAX_TOKENS_HAIKU` |

```typescript
// LLMClient — 可配置默认值
private getMaxTokens(model: string): number {
  switch (model) {
    case this.config.llmOpusModel:   return Number(process.env.LLM_MAX_TOKENS_OPUS) || 40960;
    case this.config.llmSonnetModel: return Number(process.env.LLM_MAX_TOKENS_SONNET) || 5120;
    case this.config.llmHaikuModel:  return Number(process.env.LLM_MAX_TOKENS_HAIKU) || 512;
    default: return 4096;
  }
}

private getThinkingBudget(): number {
  return Number(process.env.LLM_THINKING_BUDGET) || 0; // 0 = 按模型自动选择
}
```

### 文件变更

```
backend/src/llm/client.ts  🔧 stream(): thinking 参数 + thinking_delta + 5x maxTokens + 环境变量配置
```

### 非目标

- ❌ 前端展示思考过程
- ❌ Haiku thinking（不支持）
- ❌ 非 Anthropic provider 兼容
