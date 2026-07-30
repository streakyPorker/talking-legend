# RFC-011 Design: NPC 对话面板

> **状态**: 正在进行
> **创建**: 2026-07-31
> **grill 结论**: 2026-07-31

## 决策记录

### 1. 入口与布局

**决策**: 侧栏 NearbyNpcs 点击 → 右侧抽屉滑入

- 抽屉覆盖侧栏区域，固定 380px
- 不遮挡叙事面板
- `z-40`，高于侧栏 `z-0`
- 单抽屉模式：点击新 NPC 先关闭当前抽屉

### 2. 对话 UI

**决策**: 聊天气泡 + 角色名 + 流式输出

- NPC 消息: `chat-start`, `bg-neutral text-neutral-content`
- 玩家消息: `chat-end`, `bg-primary text-primary-content`
- 每条消息显示角色名小标签
- GM 叙事和 NPC 对话完全独立 — NPC 回复不在叙事面板显示

### 3. NPC ↔ GM 关系

**决策**: 独立流 + 异步摘要通知

- NPC 对话和 GM 叙事是两个独立 SSE 流
- NPC 对话完成后，**haiku 生成一句话摘要**
  - 例："村长告知了玩家关于龙脊峰有龙的警告"
- 摘要写入 GM context（`narrative_history` 模块），下次 GM 生成时感知
- 触发时机：`done` 事件后，前端调 `POST /api/game/:id/npc/:npcId/summary`

### 4. 流式输出

**决策**: 逐字流式 SSE + XML 标签

- 后端: `POST /api/game/:gameId/npc/:npcId/talk/stream`（已实现）
- 前端: SSE `chunk` → 追加到当前气泡，`done` → 完成
- NPC 回复使用 XML 标签：`<dialogue speaker="name">台词</dialogue>`
- 抽屉内气泡用 `TagRenderer` 渲染

### 5. NPC Prompt 系统

**决策**: 模板驱动 + 属性注入，兼容静态和动态 NPC

**约束**: 未来 RFC-008 世界演化会动态生成 NPC → prompt 不能依赖手写配置

**方案**: 通用 NPC 对话模板，运行时从 NPC 属性组装 prompt

- **模板** `templates/npc/dialogue/system.md`:
  ```
  你是{{npcName}}，{{npcRole}}。
  性格：{{npcPersonality}}
  当前位置：{{npcLocation}}
  当前心情：{{npcMood}}
  对玩家的了解：{{npcMemories}}
  世界状态：{{worldState}}
  
  用符合你身份和性格的方式与玩家对话。使用 XML 标签格式化回复。
  ```
- **属性来源**: 统一从 `npcs` DB 表读取（`name/role/personality/location/mood`）
  - 静态 NPC: 创建游戏时从 worlds JSON seed 到 npcs 表
  - 动态 NPC: 演化系统 INSERT 到 npcs 表，字段与静态 NPC 完全一致
  - 前端/后端只读 DB，不关心 NPC 来源
  - 重启后所有 NPC 从 DB 恢复，worlds JSON 只是初始种子
- **可选覆盖**: world JSON 可提供 `promptHint` 字段追加个性化指引，但不是必须
- **与 GM 分离**: NPC 不知道自己是"游戏角色"，只知道自己的身份

### 6. NPC 持久化策略

**决策**: DB 为主，worlds JSON 只是初始种子

```
创建游戏:  worlds JSON → seed npcs 表
运行时:    所有 NPC 从 npcs 表读写
动态生成:  INSERT npcs 表（字段与静态一致）
重启恢复:  npcs 表 → 恢复所有 NPC（静态+动态）
```

- 静态/动态 NPC 对前端和后端完全透明
- `npcs` 表字段: `id, game_id, name, role, personality, location, current_mood, is_alive`
- 动态 NPC 只需填相同字段，prompt 模板自动适配

### 7. NPC 记忆持久化（Phase B 合并）

**决策**: 本期一起做，结构化记忆

- **表扩展**: `npc_memories` 加 `importance` 字段（1-5），加 `type` 字段（`dialogue`/`event`/`summary`）
- **存储**: 每次对话完成 → 写入 memory（玩家消息 + NPC 回复摘要）
- **加载**: 抽屉打开时 → 调 API 取最近 N 条记忆
- **注入**: `NpcContextBuilder` 的 `npc_memory` 模块已有，确保包含新字段
- **前端**: 抽屉头部可展开记忆摘要列表，按 importance 排

### 7. 抽屉内容

```
┌─────────────────────────────────┐
│ 🧑 村长   😊               [✕] │  ← NPC 状态头
│ 村庄领袖 · 和蔼但谨慎             │
│ 📝 记忆: "警告过玩家龙脊峰危险"    │  ← 可展开记忆摘要
├─────────────────────────────────┤
│  ┌──────────────────────┐       │
│  │ 村长                   │       │  ← NPC 气泡 (TagRenderer)
│  │ 欢迎来到石辉村...       │       │
│  └──────────────────────┘       │
│       ┌──────────────────┐      │
│       │ 我想打听龙脊峰    │      │  ← 玩家气泡
│       └──────────────────┘      │
│  ┌──────────────────────┐       │
│  │ 村长                   │       │
│  │ 龙脊峰...（流式输出中） │       │  ← 加载态
│  └──────────────────────┘       │
├─────────────────────────────────┤
│ [  输入你想说的话...    ] [发送] │  ← 输入栏
└─────────────────────────────────┘
```

## 涉及文件

### 前端

| 文件 | 变更 |
|------|------|
| `components/game/NpcDialogueDrawer.tsx` | **新建**: 抽屉 + 气泡 + 输入栏 + 记忆展开 |
| `services/api.ts` | 新增 `talkToNpcStream()` + `getNpcMemories()` + `submitNpcSummary()` |
| `hooks/useNpcDialogue.ts` | **新建**: SSE 流式 hook |
| `components/game/NearbyNpcs.tsx` | NPC 列表项加点击 → openDrawer |
| `components/game/GameScreen.tsx` | 集成 NpcDialogueDrawer |

### 后端

| 文件 | 变更 |
|------|------|
| `templates/npc/dialogue/system.md` | **新建**: NPC prompt 模板 |
| `world-config/world-config.schema.ts` | NpcConfig 可选加 `promptHint` 字段 |
| `worlds/*/world.json` | NPC 可选 `promptHint`（非必须） |
| `db/migrate.ts` | v3: `npc_memories` 加 `importance`, `type` |
| `npc/npc.service.ts` | Map→DB 读写记忆 + 摘要生成端点 |
| `npc/npc.controller.ts` | 新增 `POST :npcId/summary` 端点 |
| `context/modules/npc-memory.module.ts` | 按 importance 排序渲染 |

## 交互流程

```
1. 玩家点击 NearbyNpcs → 抽屉滑入
2. 加载 NPC 记忆 → 显示在头部
3. 输入 → 发送 → SSE 流式
4. NPC 回复逐字气泡
5. 可继续多轮对话
6. done → haiku 生成摘要 → 注入 GM context
7. 关闭抽屉 → 记忆已持久化
```

## 边界情况

- NPC 不在同区域：NearbyNpcs 只列同区域 NPC
- SSE 断流：error toast，保留已接收内容
- LLM 不可用：fallback → NPC 沉默/兜底文案
- 快速点击多 NPC：关闭当前，打开新（单抽屉）
- 抽屉打开时拖侧栏：抽屉固定 380px 不跟随
- NPC 第一次对话：无记忆，显示 "初次见面"
