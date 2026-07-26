# RFC-004: 上下文管理与Prompt设计 — 执行记录

> **状态**: 已完成
> **开始**: 2026-07-26（design 审批通过）
> **执行方式**: ralph 模式 — PRD-driven，story-by-story 实现

## 执行计划

| 任务 | 内容 | 状态 |
|------|------|------|
| US-001 | 核心类型与接口定义（ContextModule 接口 + ModuleConfig + CallType + AssembledContext） | ✅ |
| US-002 | ContextBudgetExceededError | ✅ |
| US-003 | TemplateEngine 实现（加载 .md + {{}}替换 + 校验） + 10 测试 | ✅ |
| US-004 | Prompt 模板文件（8个.md） + Schema 文件（4个.ts） | ✅ |
| US-005 | NarrativeHistoryManager（近端+摘要分层管理） + 8 测试 | ✅ |
| US-006 | MemoryFilter（三级记忆分级过滤） + 13 测试 | ✅ |
| US-007 | 8 个 ContextModule 实现（world/npc-persona/npc-memory/player/narrative-history/active-events/scenario-hint/intent-input） + 19 测试 | ✅ |
| US-008 | ContextBuilder（Base + GM/Npc/Intent/Event + trim 降级逻辑） + 9 测试 | ✅ |
| US-009 | 完工验证（全量测试 + tsc + build） | ✅ |

## 交付物

### 后端新增文件

```
backend/src/context/
  context-module.interface.ts     # ContextModule / GatherContext / ModuleData / AssembledContext / Granularity / CallType
  context-budget.error.ts         # ContextBudgetExceededError
  module-config.ts                # DEFAULT_MODULE_CONFIG（4种调用类型默认配置）
  narrative-history.ts            # NarrativeHistoryManager（近端+摘要分层）
  memory-filter.ts                # MemoryFilter（important/normal/trivial 三级过滤）
  context-builder.ts              # BaseContextBuilder + GM/Npc/Intent/Event Builder（组装+trim）
  index.ts                        # 统一导出
  modules/
    base.module.ts                # BaseContextModule 基类
    world-state.module.ts         # 世界状态模块 [强制]
    npc-persona.module.ts         # NPC 人设模块 [NPC对话强制]
    npc-memory.module.ts          # NPC 记忆模块
    player-state.module.ts        # 玩家状态模块
    narrative-history.module.ts   # 叙事历史模块
    active-events.module.ts       # 活跃事件模块
    scenario-hint.module.ts       # 场景指引模块
    intent-input.module.ts        # 意图输入模块 [意图分类强制]
    index.ts                      # 统一导出

backend/src/prompts/
  template-engine.ts              # TemplateEngine（dot notation → 文件路径 + {{}}替换 + 校验）
  index.ts                        # 统一导出
  templates/
    gm/narrative/{system,user}.md
    npc/dialogue/{system,user}.md
    intent/classify/{system,user}.md
    event/trigger/{system,user}.md
  schemas/
    gm/narrative.schema.ts
    npc/dialogue.schema.ts
    intent/classify.schema.ts
    event/trigger.schema.ts
```

### 前端修复

```
frontend/
  vitest.config.ts                # 新增 — jsdom 环境 + globals（修复 App.test.tsx 预存失败）
  src/test-setup.ts               # 修正 — @testing-library/jest-dom/vitest 导入路径
```

### 测试

| 文件 | 测试数 |
|------|--------|
| `narrative-history.spec.ts` | 8 |
| `memory-filter.spec.ts` | 13 |
| `template-engine.spec.ts` | 10 |
| `modules/modules.spec.ts` | 19 |
| `context-builder.spec.ts` | 9 |
| **新增合计** | **59** |

存量 88 后端 + 1 前端 = 总共 148，全部通过。

## 验证证据

### 1. 测试

```
npm test
  ✓ 15 test files passed (1 frontend + 14 backend)
  ✓ 148 tests passed (no failures)
```

### 2. Typecheck

```
npm run typecheck
  @talking-legend/shared   → tsc --noEmit ✓
  @talking-legend/backend  → tsc --noEmit ✓
  @talking-legend/frontend → tsc --noEmit ✓
```

### 3. 构建

```
npm run build -w backend
  Successfully compiled: 79 files with swc (282ms)
```

## 核心设计决策（参见 design.md）

| 决策 | 结论 |
|------|------|
| 范围 | 纯契约/设计层 — 接口+模板+管线，不写 LLM 调用代码 |
| 上下文组装 | 4 个 ContextBuilder（GM/Npc/Intent/Event），各自装配模块组合 |
| 模块化 | 8 个可插拔 ContextModule，默认配置硬编码，后续可 LLM 决策 |
| 模板系统 | .md 文件 + TS schema + TemplateEngine，dot notation 引用 |
| 叙事历史 | 分层（近端 5 轮原文 + 远端 Haiku 摘要） |
| NPC 记忆 | 三级过滤（important 永久 / normal 最近10 / trivial 仅计数） |
| Token 预算 | 非强制模块逐模块降级 full→compact→minimal，强制模块不可降，超预算 fail fast |

## 遗留事项

| # | 内容 | 处置 |
|---|------|------|
| L1 | 所有非强制 minimal 后仍超预算 → fail fast | 已记录，后续实际场景决定策略 |
| L2 | 前端模块配置页面 | 新 RFC，待前端搭建后提出 |
| L3 | LLM 自主决策模块组合 | 未来迭代 |
| L4 | 精确 token 计数（tiktoken） | 当前用字符数/2 估算 |
| L5 | NPC 记忆分级替换为 Haiku 判断 | 当前用启发式规则，RFC-007 接入后替换 |
