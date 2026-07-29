# RFC-014: 配置中心页面

> **状态**: 设计中（grill-me 深度访谈产出）
> **优先级**: P0（紧急）
> **创建**: 2026-07-29
> **依赖**: —（独立）

## 设计决策

| # | 决策 | 结论 |
|---|------|------|
| D1 | 范围 | 全部 16 项配置（7 组），不可减少 |
| D2 | 入口 | GameSetup「⚙」+ GameScreen 右上角齿轮图标 |
| D3 | 生效方式 | 可热加载(5组)→即时生效 / 不可热加载(2组)→写入文件提示重启 |
| D4 | UI 框架 | **Tailwind CSS + daisyUI**（B3 方案） |
| D5 | 后端 API | `GET /api/config` + `PUT /api/config` |
| D6 | TOML 写回 | **行级替换保留注释**（正则逐行匹配） |
| D7 | 编号 | RFC-014，P0，插入到 013 之后 |

## 配置热加载分类

| 配置组 | 项数 | 可热加载 | 说明 |
|--------|------|----------|------|
| `llm.max_tokens` | 3 | ✅ | stream() 每次调用读取 |
| `llm.thinking` | 2 | ✅ | stream() 每次调用读取 |
| `llm.context_budget` | 3 | ✅ | ContextProvider 每次读取 |
| `llm.stream` (timeout) | 1 | ✅ | stream() 每次调用读取 |
| `npc` (history_rounds) | 1 | ✅ | 改为每次 talkStream() 时读取 |
| `anthropic` (models) | 3 | ❌ | LLMClient 实例化时缓存，需重启 |
| `server` (port) | 1 | ❌ | HTTP 端口绑定，需重启 |
| `model_tiers` | 3 | ❌ | 前缀匹配，需重启 |

**实现方式**：ConfigService 新增 `reloadToml()` 方法重读文件。热加载项的 getter 始终从 `this.toml` 读取最新值。不可热加载项的 getter 启动时一次缓存。

## 架构

```
GameSetup                     GameScreen
  └─ ⚙ 配置                    └─ 右上角 ⚙
       │                            │
       └──── ConfigScreen ───────────┘
                  │
         ┌───────┴───────┐
         │ GET /api/config │  ← 读取全部 16 项 + 热加载标记
         │ PUT /api/config │  ← 写入部分项 + 热生效
         └───────┬───────┘
                 │
         ConfigService.reloadToml()
                 │
         可热加载项即时生效
         不可热加载项 → 前端提示重启
```

## 1. 后端 API

### `GET /api/config`

```json
{
  "sections": [
    {
      "key": "anthropic",
      "label": "模型配置",
      "restartRequired": true,
      "items": [
        { "key": "opus_model", "label": "Opus 模型", "value": "claude-opus-4-8", "type": "text", "hotReload": false },
        { "key": "sonnet_model", "label": "Sonnet 模型", "value": "claude-sonnet-4-6", "type": "text", "hotReload": false },
        { "key": "haiku_model", "label": "Haiku 模型", "value": "claude-haiku-4-5-20251001", "type": "text", "hotReload": false }
      ]
    },
    {
      "key": "llm.max_tokens",
      "label": "Token 预算 (max_tokens)",
      "restartRequired": false,
      "items": [
        { "key": "opus", "label": "Opus", "value": 40960, "type": "number", "hotReload": true },
        { "key": "sonnet", "label": "Sonnet", "value": 5120, "type": "number", "hotReload": true },
        { "key": "haiku", "label": "Haiku", "value": 512, "type": "number", "hotReload": true }
      ]
    },
    ...
  ]
}
```

### `PUT /api/config`

```json
// 请求：只发修改的项
{
  "changes": {
    "llm.max_tokens.opus": 80000,
    "npc.history_rounds": 30
  }
}

// 响应
{
  "applied": ["llm.max_tokens.opus", "npc.history_rounds"],
  "restartRequired": [],
  "errors": []
}
```

**TOML 写回**：接收 dot-path key → 解析 `[section]` 和 `key = value` → 逐行正则匹配替换 → 保留注释。匹配失败时 fallback 到追加新行。

## 2. ConfigScreen（前端）

daisyUI 组件：
- `drawer` 或 `modal` 弹出配置面板
- `collapse` 折叠 7 个配置分组
- `input` / `input[type=number]` 表单控件
- `badge` 标记"热生效" / "需重启"
- `btn` 保存按钮

```
┌────────────────────────────────────────┐
│  ⚙ 配置中心                          ✕ │
├────────────────────────────────────────┤
│ ▼ 模型配置 (需重启)                     │
│   Opus 模型   [claude-opus-4-8      ]  │
│   Sonnet 模型 [claude-sonnet-4-6    ]  │
│   Haiku 模型  [claude-haiku-4-5...  ]  │
│                                        │
│ ▼ Token 预算 (热生效)                   │
│   Opus   [40960]  🔥                   │
│   Sonnet [5120 ]  🔥                   │
│   Haiku  [512  ]  🔥                   │
│                                        │
│ ▼ Extended Thinking (热生效)            │
│   Opus budget   [4096]  🔥             │
│   Sonnet budget [2048]  🔥             │
│                                        │
│ ... (4 more sections) ...              │
├────────────────────────────────────────┤
│          [保存配置]                     │
│  3 项热生效 · 2 项需重启后端            │
└────────────────────────────────────────┘
```

## 3. Tailwind + daisyUI 引入

```bash
npm install -D tailwindcss @tailwindcss/vite -w frontend
npm install -D daisyui -w frontend
```

`tailwind.config.js`:
```js
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [require('daisyui')],
  daisyui: { themes: ['dark'] },
}
```

## 4. 文件变更

```
backend/src/
  config/
    config.controller.ts       ✨ NEW：GET/PUT /api/config
    config.service.ts           🔧 +reloadToml() + 热加载项改为实时读取
    config.module.ts            🔧 注册 ConfigController

frontend/src/
  components/
    ConfigScreen.tsx            ✨ NEW：配置面板
  App.tsx                       🔧 第三视图切换
  services/api.ts               🔧 +getConfig() +updateConfig()
  index.css                     🔧 Tailwind directives

frontend/
  tailwind.config.js            ✨ NEW
  vite.config.ts                🔧 @tailwindcss/vite plugin

package.json                    🔧 +tailwindcss +daisyui deps
```

## 5. 测试策略

| 层级 | 内容 |
|------|------|
| 单元 | ConfigController GET/PUT — mock ConfigService |
| 单元 | ConfigService.reloadToml() — 验证文件重读 |
| 单元 | TOML 行级替换 — 保留注释/匹配/追加 |
| 组件 | ConfigScreen 渲染 7 组 16 项 + 保存回调 |

## 6. 非目标

- ❌ 配置历史/回滚
- ❌ 多配置文件切换
- ❌ 配置导入/导出
- ❌ 移动端适配
