# RFC-010: 前端组件化重构 — 设计文档

> **状态**: 设计完成（grill-me 8/8 决策闭合）
> **优先级**: P2
> **创建**: 2026-07-26
> **更新**: 2026-07-30

---

## 1. 现状分析

### 1.1 当前组件结构

```
App.tsx (31L)                 ← Routes + showConfig toggle
├── GameSetup.tsx (149L)      ← 入口页：姓名输入 + 创建游戏
├── GameScreen.tsx (287L)     ← 游戏页：叙事流 + 侧边栏 + 输入框（单体巨石）
└── ConfigScreen.tsx (348L)   ← 配置面板：加载/编辑/保存/重置
```

**核心问题**：
- **Tailwind v4 + daisyUI 5 已安装但未使用** — 所有组件仍用内联 `<style>` 标签
- **Zustand 未安装** — 状态跨组件共享靠 location.state + props 传递
- **GameScreen = 287 行巨石** — 包含叙事流、SSE 解析、Markdown 渲染、侧边栏、输入表单、所有 CSS
- **无共享 UI 组件** — Button/Input/Modal/Toast/Loading 每个组件手写一遍
- **中文映射表散落** — REGION_CN/WEATHER_CN/TIME_CN 三个映射表只在 GameScreen 内

### 1.2 与 RFC-015 的关系

RFC-015（前端导航栏重构）提出创建 `TopNavBar` + `InfoPopover` + 去掉侧边栏。本 RFC 先建立组件体系和 UI kit，RFC-015 在此基础上实现导航栏。顺序：**RFC-010 先 → RFC-015 后**。

---

## 2. 架构设计

### 2.1 目标组件树

```
App.tsx
├── GameSetup                          ← 入口页（精简，去掉内联 style）
│   └── [shared: Button, Input, ConfigGear]
├── GameScreen                         ← 游戏页（拆分为子组件）
│   ├── GameHeader                     ← 顶部栏：世界名 + 状态 + 齿轮
│   │   ├── GameStatusBar              ← 区域/回合/时间/天气
│   │   └── ConfigGear                 ← 配置齿轮按钮
│   ├── NarrativePanel                 ← 叙事区（纯展示）
│   │   └── NarrativeLine              ← 单条叙事行（PlayerAction / WorldNarrative）
│   ├── RegionSidebar                  ← 右侧信息面板
│   │   ├── RegionInfo                 ← 当前位置 + 描述
│   │   ├── ConnectedRegions           ← 可前往区域列表
│   │   ├── QuestList                  ← 任务列表
│   │   └── NearbyNpcs                 ← 附近 NPC 卡片
│   └── ActionBar                      ← 底部输入栏
└── ConfigScreen                       ← 配置面板（精简，共用 Toast）
    └── [shared: Modal, Toast, Button, Spinner]
```

### 2.2 目录结构

```
frontend/src/
├── App.tsx
├── main.tsx
├── index.css                          ← Tailwind + daisyUI + 自定义变量
├── stores/
│   └── gameStore.ts                   ← Zustand store（游戏状态）
├── hooks/
│   ├── useGameAction.ts               ← 叙事流 SSE + 状态更新
│   └── useConfig.ts                   ← 配置 CRUD + toast
├── components/
│   ├── ui/                            ← 共享 UI 组件（Tailwind + daisyUI）
│   │   ├── Button.tsx
│   │   ├── Input.tsx
│   │   ├── Spinner.tsx
│   │   └── Toast.tsx
│   ├── game/                          ← 游戏相关组件
│   │   ├── GameSetup.tsx
│   │   ├── GameScreen.tsx
│   │   ├── GameHeader.tsx
│   │   ├── GameStatusBar.tsx
│   │   ├── NarrativePanel.tsx
│   │   ├── NarrativeLine.tsx
│   │   ├── RegionSidebar.tsx
│   │   ├── RegionInfo.tsx
│   │   ├── ConnectedRegions.tsx
│   │   ├── QuestList.tsx
│   │   ├── NearbyNpcs.tsx
│   │   └── ActionBar.tsx
│   └── config/                        ← 配置相关组件
│       └── ConfigScreen.tsx
├── services/
│   └── api.ts                         ← API 客户端（不变）
├── utils/
│   ├── i18n.ts                        ← 中文映射表（REGION_CN/WEATHER_CN/TIME_CN）
│   └── markdown.ts                    ← Markdown 渲染工具
└── __tests__/
    ├── App.test.tsx
    ├── components/
    │   ├── GameSetup.test.tsx
    │   ├── GameScreen.test.tsx
    │   ├── NarrativePanel.test.tsx
    │   └── ...
    └── utils/
        ├── i18n.test.ts
        └── markdown.test.ts
```

---

## 3. 设计决策表

| ID | 决策点 | 选项 | 选择 | 理由 |
|----|--------|------|------|------|
| D1 | 状态管理库 | Zustand / Jotai / Redux / 不用 | **Zustand** | 设计目标栈已定；API 简洁无 boilerplate；与 React 18 兼容 |
| D2 | UI 组件库 | 手写 Tailwind / daisyUI 组件 / Headless UI | **Tailwind + daisyUI** | 已安装 v4+v5；减少 CSS 体积；组件语义化 |
| D3 | 共享 UI 组件粒度 | Button+Input+Modal+Toast / 更细 / 更粗 | **Button + Input + Spinner + Toast** | 覆盖当前重复模式，不过度设计 |
| D4 | GameScreen 拆分粒度 | 头/叙事/侧边栏/输入 / 更细 | **7 个子组件** | 每个子组件单一职责，可独立测试 |
| D5 | 内联 style 处理 | 全部迁移 Tailwind / 保留 / 混合 | **全部迁移 Tailwind** | 统一样式体系，减少维护成本 |
| D6 | ConfigScreen 中的 toast | 共用 Toast 组件 / 保留独立 | **共用 Toast** | toast 是通用 UI 模式 |
| D7 | 中文映射表位置 | 放 utils/i18n.ts / 保留在组件内 | **utils/i18n.ts** | 单一数据源，方便后续加语言 |
| D8 | Markdown 渲染器 | 放 utils/markdown.ts / 保留在组件内 | **utils/markdown.ts** | 可复用，可独立测试 |
| D9 | 自定义 hook 设计 | useGameAction(SSE) + useConfig / 更多 | **useGameAction + useConfig** | 覆盖当前两个主要异步流程 |
| D10 | Zustand store 结构 | 单一 store / 分 slice | **单一 store（<100行）** | 当前状态量小，单一 store 简单够用 |
| D11 | 向前兼容 | 保持现有 props 接口 / 可以打破 | **可以打破** | GameScreen 的 gameState prop → store；onGameUpdate → store action |
| D12 | Modal 组件 | 用 daisyUI modal / 手写 | **daisyUI modal** | 已在 ConfigScreen 验证，减少重复代码 |
| D13 | RFC-015 时序 | 010 先 / 015 先 / 合并 | **010 先** | 015 的 TopNavBar/InfoPopover 应使用 010 的 UI kit 和 store |

### 3.1 Grill-me 深度访谈结论（2026-07-30）

| Q# | 决策点 | 结论 | 影响 |
|----|--------|------|------|
| Q1 | Tailwind 迁移策略 | **一次性全迁** | 所有内联 `<style>` 删除，3 组件全部重写 |
| Q2 | Store 粒度 | **gameState + narrative 进 store，loading/error 本地** | Store 精简；loading/error 是 UI 状态不进全局 |
| Q3 | 侧边栏拆分粒度 | **全拆独立文件** | 子组件不依赖 RegionSidebar 容器，RFC-015 可直接复用 |
| Q4 | ConfigScreen 重构深度 | **useConfig hook + Toast 共用，面板单体** | 不拆 ConfigSection，因 8 sections 同质化循环渲染 |
| Q5 | 共享 UI 组件范围 | **Button + Input + Spinner + Toast，4 个** | daisyUI collapse/modal/alert/badge 直接用原生 className |
| Q6 | 主题体系 | **全用 daisyUI 语义色** | index.css 精简至 ~8 行，删除自定义 CSS 变量 |
| Q7 | 测试策略 | **关键路径覆盖** | 必测：i18n/markdown/gameStore/useGameAction/App/NarrativePanel |
| Q8 | RFC-015 协调 | **子组件独立可复用** | RegionInfo 等不依赖 RegionSidebar，RFC-015 直接拿用 |

---

## 4. Zustand Store 设计

```typescript
// stores/gameStore.ts
import { create } from 'zustand';
import type { GameState } from '@talking-legend/shared';

// Q2 结论: gameState + narrative 进 store；loading/error 留在组件本地 useState
interface GameStore {
  gameState: GameState | null;
  setGameState: (state: GameState) => void;
  updateTurn: (turn: number) => void;
  clearGame: () => void;

  narrative: string[];
  addPlayerAction: (action: string) => void;
  appendNarrativeChunk: (chunk: string) => void;
  clearNarrative: () => void;
}
```

**为什么把 narrative 放进 store**：叙事流在 GameScreen 内部使用，但 RFC-011（NPC 对话面板）和 RFC-015（导航栏重构）可能需要引用叙事上下文。放入 store 避免后续再迁移。

---

## 5. 组件接口设计

### 5.1 共享 UI 组件

```typescript
// ui/Button.tsx
interface ButtonProps {
  variant: 'primary' | 'ghost' | 'circle';
  disabled?: boolean;
  loading?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  ariaLabel?: string;
  className?: string;
  type?: 'button' | 'submit';
}

// ui/Input.tsx
interface InputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
  id?: string;
  label?: string;
}

// ui/Spinner.tsx — 无 props，纯展示 loading 动画
// ui/Toast.tsx
interface ToastProps {
  message: string;
  type: 'success' | 'error' | 'info';
  onDismiss: () => void;
}
```

### 5.2 游戏组件

```typescript
// GameSetup — props 简化，用 navigate + store
interface GameSetupProps { onOpenConfig: () => void; }

// GameScreen — 不再接收 gameState prop，从 store 读取
interface GameScreenProps { onOpenConfig: () => void; }

// GameHeader — 从 store 读取 world name
interface GameHeaderProps { onOpenConfig: () => void; }

// GameStatusBar — 从 store 读取 turn/region/time/weather
// NarrativePanel — 从 store 读取 narrative[]
// NarrativeLine — 纯展示：type + text
interface NarrativeLineProps { type: 'player' | 'world'; text: string; }

// RegionSidebar — 从 store 读取 world.regions + player.quests + npcs
// RegionInfo — 纯展示：regionName + description
// ConnectedRegions — 纯展示：regions[]
// QuestList — 纯展示：quests[]
// NearbyNpcs — 纯展示：npcs[]

// ActionBar — 内部管理 input state，调用 useGameAction
```

---

## 6. 自定义 Hook 设计

```typescript
// hooks/useGameAction.ts
function useGameAction() {
  // 从 store 读取 gameState, isLoading
  // 返回 execute(actionText) — 调用 performActionStream + 更新 store
  // 内部管理 SSE 流解析
}

// hooks/useConfig.ts
function useConfig() {
  // 管理 config sections, dirty tracking, toast messages
  // 返回 { sections, isLoading, saveConfig, resetConfig, ... }
}
```

---

## 7. Tailwind 迁移策略

| 当前写法 | Tailwind 替换 |
|----------|--------------|
| `padding: 0.75rem 1.5rem` | `px-6 py-3` |
| `border: 2px solid var(--color-secondary)` | `border-2 border-secondary` |
| `border-radius: 8px` | `rounded-lg` |
| `background: var(--color-bg)` | `bg-base-100`（daisyUI） |
| `color: var(--color-primary)` | `text-primary`（daisyUI） |
| `font-size: 1.3rem` | `text-xl` |
| `display: flex; gap: 1rem` | `flex gap-4` |
| `min-height: 100vh` | `min-h-screen` |
| `justify-content: center; align-items: center` | `justify-center items-center` |

自定义 CSS 变量通过 daisyUI 主题变量映射：
```css
/* index.css 新增 */
@plugin "daisyui" {
  themes: darkfantasy --default;
}
```

保留在 `index.css` 的全局样式：仅 `#root` flex 布局 + daisyUI 主题变量自定义。

---

## 8. 文件变更清单（含 Wave 分阶段）

### Wave 1：基础设施（无依赖）
| 文件 | 操作 | 内容 |
|------|------|------|
| `src/stores/gameStore.ts` | **新建** | Zustand store |
| `src/utils/i18n.ts` | **新建** | 中文映射表 |
| `src/utils/markdown.ts` | **新建** | Markdown 渲染 |
| `src/components/ui/Button.tsx` | **新建** | 共享 Button |
| `src/components/ui/Input.tsx` | **新建** | 共享 Input |
| `src/components/ui/Spinner.tsx` | **新建** | 共享 Spinner |
| `src/components/ui/Toast.tsx` | **新建** | 共享 Toast |

### Wave 2：组件拆分（依赖 Wave 1）
| 文件 | 操作 | 内容 |
|------|------|------|
| `src/hooks/useGameAction.ts` | **新建** | 叙事流 hook |
| `src/hooks/useConfig.ts` | **新建** | 配置 hook |
| `src/components/game/NarrativeLine.tsx` | **新建** | 单条叙事行 |
| `src/components/game/NarrativePanel.tsx` | **新建** | 叙事面板 |
| `src/components/game/GameStatusBar.tsx` | **新建** | 状态栏 |
| `src/components/game/GameHeader.tsx` | **新建** | 顶部栏 |
| `src/components/game/RegionInfo.tsx` | **新建** | 区域信息 |
| `src/components/game/ConnectedRegions.tsx` | **新建** | 可前往区域 |
| `src/components/game/QuestList.tsx` | **新建** | 任务列表 |
| `src/components/game/NearbyNpcs.tsx` | **新建** | 附近 NPC |
| `src/components/game/RegionSidebar.tsx` | **新建** | 侧边栏容器 |
| `src/components/game/ActionBar.tsx` | **新建** | 输入栏 |

### Wave 3：集成层（依赖 Wave 2）
| 文件 | 操作 | 内容 |
|------|------|------|
| `src/components/game/GameSetup.tsx` | **改写** | 用 shared UI + Tailwind |
| `src/components/game/GameScreen.tsx` | **改写** | 拆分为子组件组合 |
| `src/components/config/ConfigScreen.tsx` | **改写** | 用 shared UI + useConfig |
| `src/App.tsx` | **改写** | 更新 import 路径 |
| `src/index.css` | **改写** | 精简为 daisyUI 主题变量 |

### Wave 4：测试（依赖 Wave 3）
| 文件 | 操作 |
|------|------|
| `src/__tests__/utils/i18n.test.ts` | **新建** |
| `src/__tests__/utils/markdown.test.ts` | **新建** |
| `src/__tests__/components/GameSetup.test.tsx` | **新建** |
| `src/__tests__/components/GameScreen.test.tsx` | **新建** |
| `src/__tests__/components/NarrativePanel.test.tsx` | **新建** |
| `src/__tests__/App.test.tsx` | **更新** |

---

## 9. 伪代码

### 9.1 GameScreen 重构后主体

```tsx
export function GameScreen({ onOpenConfig }: GameScreenProps) {
  const gameState = useGameStore(s => s.gameState);
  const navigate = useNavigate();
  
  if (!gameState) { /* redirect to / */ return null; }

  return (
    <div className="min-h-screen flex flex-col">
      <GameHeader onOpenConfig={onOpenConfig} />
      <main className="flex-1 flex gap-4 p-6 overflow-hidden">
        <NarrativePanel />
        <RegionSidebar />
      </main>
      <ActionBar />
    </div>
  );
}
```

### 9.2 Zustand store 关键方法

```tsx
// 叙事流追加（SSE chunk 累积在最后一行）
appendNarrativeChunk: (chunk) => set(state => {
  const lines = [...state.narrative];
  lines[lines.length - 1] = (lines[lines.length - 1] || '') + chunk;
  return { narrative: lines };
}),
```

---

## 10. 测试策略（Q7：关键路径覆盖）

- **必测**：`utils/i18n.ts`、`utils/markdown.tsx`、`stores/gameStore.ts`、`hooks/useGameAction.ts`、`App.test.tsx`（更新）、`NarrativePanel.test.tsx`
- **跳过独立测试**：GameStatusBar、RegionInfo、ConnectedRegions、QuestList、NearbyNpcs、ActionBar、NarrativeLine（纯展示组件，无逻辑分支）
- 覆盖率目标：utils 100%，store 100%，hooks 核心路径，App 保持现有测试

---

## 11. 安装依赖

```bash
npm install zustand -w frontend
```

（Tailwind v4 + daisyUI 5 + react-router-dom 已安装，无需额外操作）
