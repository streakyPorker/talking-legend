# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **快速上手**：本文档是项目的"最新快照"——每个 RFC 完工后同步更新。新会话 `/init` 时，读本文档 + 几次 `codegraph_explore` 搜索关键符号 + 查看 RFC 进度表，即可掌握项目全貌，无需大量读文件。
>
> **Agent 模型约定**：
> - 探索类（Explore）→ `sonnet`。性价比最优，足覆盖代码搜索和架构理解。
> - 实现类（Implement）→ 并行 `sonnet` agent，文件级隔离（两两不修改同一文件），翻 Wave 依赖。**硬性要求：agent 交货必须自带验证结果（typecheck + test 输出），无验证结果的交付视为不合格**——接手即可 typecheck + build 通过。
> - 审查类（Review）→ 并行 `sonnet` agent，从不同视角对抗审视（功能正确性/回归安全/代码质量）。
> - 验收类 → Playwright 深度体验（多页面截图 + 交互验证）。
> - 测试策略 → 现阶段不做回归测试，第一个大版本发布后再考虑。
>
> **交互约定**：grill-me 设计访谈使用 `AskUserQuestion` 工具提问，提供推荐选项和理由，让用户做选择题而非开放问答。
>
> **子 Agent 交付铁律**：每个 agent prompt 末尾必须包含验证指令（typecheck + test），agent 返回值必须有验证结果。主控抽查 build + dev 启动。

## Commands

Requires Node.js >= 18. npm workspaces monorepo (`shared` / `backend` / `frontend`) — run from repo root with `-w <workspace>`, or `cd` into the workspace.

**前后端已合并为单端口**：后端 (:31943) 托管前端静态文件，不再需要单独开前端端口。

| Task | Command |
|------|---------|
| Install | `npm install` |
| 一键拉起 | `npm start` — 构建+启动，访问 http://localhost:31943 |
| 重拉 | `npm run restart` — kill + 重建 + 启动 |
| 热更新 | `npm run hot` — kill + 构建 + watch 双进程（Vite HMR :31944 + 后端 :31943） |
| 停止 | `npm run stop` |
| Build all | `npm run build` — shared → backend → frontend |
| 并发 dev（不删DB） | `npm run dev` — backend watch + Vite HMR，跳过构建，保留数据库 |
| Backend prod | `npm run start -w backend` — 运行已构建的 dist |
| Lint | `npm run lint` |
| Typecheck | `npm run typecheck` |
| Test all | `npm test` |
| Test one file | `npx vitest run src/db/repositories/game.repository.spec.ts` (from `backend/` or `frontend/`) |
| Test by name | `npx vitest run -t "<name>"` |

Backend gotchas:
- Use the npm scripts only. Do NOT run via `tsx` (breaks NestJS decorator metadata) or `nest start` (workspace path issues) — see git history.
- Compilation is SWC (`.swcrc`: legacy decorators + decorator metadata, CommonJS out); `tsc` is typecheck-only.
- `npm start` / `npm run restart` / `npm run hot` **delete `data/talking-legend.db`** on each run. Use `npm run dev` to preserve data.
- LLM config does NOT come from a `.env` file. Priority: `env var` > `~/.claude/settings.json` (env block) > `config.toml` > hardcoded defaults. Without it the backend logs "skeleton mode".
- SQLite file lands at `backend/data/talking-legend.db`.

## Config

`config.toml` at repo root controls operational defaults — all values overridable by env vars:

| Section | Key | Default |
|---------|-----|---------|
| `[server]` | `port` | `31943` |
| `[anthropic]` | `base_url`, `opus_model`, `sonnet_model`, `haiku_model` | `api.anthropic.com`, claude-opus-4-8, etc. |
| `[model_tiers]` | `opus`, `sonnet`, `haiku` | prefix lists — includes deepseek models |
| `[llm.max_tokens]` | `opus` / `sonnet` / `haiku` | 40960 / 5120 / 512 |
| `[llm.thinking]` | `opus_budget` / `sonnet_budget` | 4096 / 2048 |
| `[llm.context_budget]` | `opus` / `sonnet` / `haiku` (chars) | 180000 / 50000 / 8000 |
| `[llm.stream]` | `timeout_ms` | `90000` |
| `[npc]` | `history_rounds` | `20` |

`ConfigService.reloadToml()` supports hot-reload via the config controller. See `config.default.toml` for the full annotated template.

## Architecture

- **`shared/`** (`@talking-legend/shared`) — TypeScript types + API contracts. Single source of truth for the frontend↔backend wire format. Compiled with `tsc` (no decorators needed); rebuild before typechecking consumers.
- **`worlds/`** — 世界配置 JSON 文件，每个子目录为一个世界（id = 目录名）。三来源合并装配（内联 + 单文件 + 目录），逐文件容错，装配后统一校验。`WorldConfigService` 在启动时加载；改配置需重启。详见 `worlds/README.md`。
- **`backend/`** — NestJS 11 + better-sqlite3, global `/api` prefix. Module breakdown:
  - **Feature modules** (`game`, `npc`, `world`, `storyline`) each follow Controller → Service → Repository. Requests validated by zod schemas (`*.schema.ts`) via a global `ZodValidationPipe`; `AllExceptionsFilter` returns structured errors; `LoggingInterceptor` logs requests. `game/` includes `ContextProvider` (RFC-016: data injection layer reading DB → creating ContextModule instances → registered in Map for `ContextBuilder.build()`), `NarrativeService` (narrative persistence), and SSE streaming endpoints (`POST /:id/action/stream`).
  - **`db/`** — `DbModule.forRoot()` is `@Global`: opens SQLite in WAL mode, runs versioned migrations from `db/migrate.ts` (tracked in `_schema_version`, each migration transactional, failure aborts startup — 9 data tables: games/worlds/npcs/npc_memories/players/player_quests/storylines/llm_logs/travel_log), and exports repositories + the `DB_INSTANCE` token. Multi-write ops run inside `db.transaction(...)`; turn bumps use optimistic concurrency. Repository specs use `createInMemoryDb()` (`:memory:`) — no Nest bootstrap needed.
  - **`config/`** (RFC-014) — Full NestJS module with `ConfigController` (GET/PUT `/api/config` for the config center page). `ConfigService` resolves values via priority chain: env var > settings.json > config.toml > hardcoded. Supports `reloadToml()` hot-reload without restart.
  - **`llm/`** — provider-agnostic client (Anthropic-compatible `/v1/messages`), 30s timeout, 3 retries with exponential backoff, placeholder fallback. Key sub-components: `GMEngine` (GM narrative generation, RFC-016: SSE streaming + tool_use loop), `NpcEngine` (NPC dialogue), `LLMClient` (base HTTP client, `StreamChunk` supports `tool_use`/`chunk`/`usage`/`stream_end`), `ThinkingHelper` (RFC-013 extended thinking budgets). `ToolRegistry` (RFC-016) manages registered `GameTool` instances; `tools/move-to.tool.ts` is the first tool implementation. Tools are registered in `LlmModule.onModuleInit()` and passed to the LLM as Anthropic-format `tools`.
  - **`world-config/`** (RFC-003) — `WorldConfigService` loads world JSON from `worlds/` directory, validates against zod schemas, merges three sources (inline/single-file/directory), skips invalid worlds with `Logger.error`.
  - **`context/`** (RFC-004) — `ContextBuilder` assembles LLM context from pluggable modules (player-state, world-state, scenario-hint, npc-persona, npc-memory, narrative-history, active-events, intent-input, travel-history). `MemoryFilter` prunes stale memories. `NarrativeHistory` manages the narrative log. Supports budget enforcement (`ContextBudgetError`). Modules live under `context/modules/` — each implements `ContextModule` with `gather()`/`render()`/`granularity`.
  - **`prompts/`** (RFC-004) — `TemplateEngine` renders prompt templates with `{{variable}}` interpolation. Templates live under `templates/`: `gm/narrative`, `npc/dialogue`, `intent/classify`, `event/trigger` — each with `system.md` + `user.md` defining expected JSON outputs.
  - **`utils/`** — `id.ts` (uuid generation), `narrative-log.ts` (file-based narrative storage alongside SQLite).
- **`frontend/`** — React 18 + Vite + TailwindCSS v4 + daisyUI 5. Vite dev server proxies `/api` → `http://localhost:31943`. `App.tsx` switches `GameSetup` ↔ `GameScreen`; `services/api.ts` is the API client (SSE streaming + REST + config). Zustand store (`stores/gameStore.ts`) holds game state + narrative lines. `hooks/useGameAction.ts` (RFC-016) drives SSE action stream with `tool_call`/`tool_result` event handling. Components structured as `components/game/` (GameScreen, GameSetup, ActionBar, ConnectedRegions, NarrativePanel, etc.), `components/ui/` (Button, Input, Toast, Spinner), `components/config/` (ConfigScreen).

Tests: Vitest everywhere — backend `node` env (colocated `*.spec.ts` + `src/__tests__/`), frontend `jsdom` + Testing Library (`src/test-setup.ts`).

## 需求开发进度

### RFC 进度表

| RFC | 标题 | 优先级 | 状态 |
|-----|------|--------|------|
| 001 | 后端模块化重构 | P0 | 已完成 |
| 002 | 数据库设计 | P0 | 已完成 |
| 003 | 世界配置加载系统 | P0 | 已完成 |
| 004 | 上下文管理与Prompt设计 | P1 | 已完成 |
| 005 | LLM接入：GM引擎与SSE | P1 | 已完成 |
| 013 | LLM思考链支持 | P0 | 已完成 |
| 006 | LLM接入：NPC对话 | P1 | 已完成 |
| 014 | 配置中心页面 | P0 | 已完成 |
| 007 | LLM接入：意图分类与事件触发 | P1 | 已提议 |
| 008 | 世界自主演化系统 | P1 | 已提议 |
| 009 | 事件链引擎 | P2 | 已提议 |
| 010 | 前端组件化重构 | P2 | 已完成 |
| 011 | 前端SSE与NPC对话面板 | P2 | 正在进行 |
| 012 | 集成测试与验收 | P3 | 已提议 |
| 015 | 前端导航栏重构（侧边栏→顶部导航） | P1 | 已提议 |
| 016 | 地域移动系统 — 点击移动 + LLM tool_use 对话移动 | P1 | 已完成 |
| 017 | 游戏存档系统 — DB 文件快照 + 槽位管理 | P1 | 正在进行 |

## RFC & Bugfix 流程

> **流程管理由 `lzy-rfc` skill 统一负责**，包括：RFC 三文件结构（proposal/design/execution）、状态流转（已提议→正在进行→已完成）、Bugfix 单文件管理、完工铁律、Playwright 验收清单、CLAUDE.md 维护清单。使用 `/lzy-rfc` 调用。

目标：每次变更后 CLAUDE.md 保持为项目"最新快照"，后续 `/init` 只需读 CLAUDE.md + 几次 codegraph 搜索即可掌握全貌。

## Git 纪律（提交前缀铁律）

| type | scope | 含义 | 例子 |
|------|-------|------|------|
| `feat` | `rfcNNN` | RFC 新功能 | `feat(rfc5): LLMClient 重构` |
| `fix` | `bfNNN` 或 `rfcNNN` | Bug 修复 | `fix(bf6-1): 中文化` |
| `chore` | — | 配置/依赖/清理 | `chore: config.toml` |
| `docs` | — | 文档/RFC 归档 | `docs: RFC-004 归档` |

**所有修改必须提交**，完成后立即 push，不允许长期保留未提交变更。




