# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

npm workspaces monorepo (`shared` / `backend` / `frontend`) — run from repo root with `-w <workspace>`, or `cd` into the workspace.

| Task | Command |
|------|---------|
| Install | `npm install` |
| 一键拉起 | `bash dev.sh` — 构建+启动前后台 (:5173 + :4001) |
| 仅后台 | `bash dev.sh backend` |
| 仅前台 | `bash dev.sh frontend` |
| 重拉 | `bash dev.sh restart` — kill + 重建 + 启动 |
| 热更新 | `bash dev.sh hot` — watch 编译 + 自动重启 |
| 停止 | `bash dev.sh stop` |
| Build all | `npm run build` — shared → backend → frontend |
| Lint | `npm run lint` |
| Typecheck | `npm run typecheck` |
| Test all | `npm test` |
| Test one file | `npx vitest run src/db/repositories/game.repository.spec.ts` (from `backend/` or `frontend/`) |
| Test by name | `npx vitest run -t "<name>"` |

Backend gotchas:
- Use the npm scripts only. Do NOT run via `tsx` (breaks NestJS decorator metadata) or `nest start` (workspace path issues) — see git history.
- Compilation is SWC (`.swcrc`: legacy decorators + decorator metadata, CommonJS out); `tsc` is typecheck-only.
- LLM config does NOT come from a `.env` file — `ConfigService` reads the `env` block of `~/.claude/settings.json` (`ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU}_MODEL`). Without it the backend logs "skeleton mode".
- SQLite file lands at `<cwd>/data/talking-legend.db`; start the backend from `backend/` so data stays in `backend/data/`.

## Architecture

- **`shared/`** (`@talking-legend/shared`) — TypeScript types + API contracts. Single source of truth for the frontend↔backend wire format. Compiled with `tsc` (no decorators needed); rebuild before typechecking consumers.
- **`worlds/`** — 世界配置 JSON 文件，每个子目录为一个世界（id = 目录名）。三来源合并装配（内联 + 单文件 + 目录），逐文件容错，装配后统一校验。`WorldConfigService` 在启动时加载；改配置需重启。详见 `worlds/README.md`。
- **`backend/`** — NestJS 11 + better-sqlite3, global `/api` prefix. Module breakdown:
  - **Feature modules** (`game`, `npc`, `world`, `storyline`) each follow Controller → Service → Repository. Requests validated by zod schemas (`*.schema.ts`) via a global `ZodValidationPipe`; `AllExceptionsFilter` returns structured errors; `LoggingInterceptor` logs requests.
  - **`db/`** — `DbModule.forRoot()` is `@Global`: opens SQLite in WAL mode, runs versioned migrations from `db/migrate.ts` (tracked in `_schema_version`, each migration transactional, failure aborts startup — 8 data tables), and exports repositories + the `DB_INSTANCE` token. Multi-write ops run inside `db.transaction(...)`; turn bumps use optimistic concurrency. Repository specs use `createInMemoryDb()` (`:memory:`) — no Nest bootstrap needed.
  - **`config/`** — `ConfigService` reads `env` block from `~/.claude/settings.json` (ANTHROPIC_AUTH_TOKEN, ANTHROPIC_BASE_URL, ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU}_MODEL). No `.env` file is used. Without config the backend logs "skeleton mode".
  - **`llm/`** — provider-agnostic client (Anthropic-compatible `/v1/messages`), 30s timeout, 3 retries with exponential backoff, placeholder fallback. Real LLM calls are mostly still TODO.
  - **`world-config/`** (RFC-003) — `WorldConfigService` loads world JSON from `worlds/` directory, validates against zod schemas, merges three sources (inline/single-file/directory), skips invalid worlds with `Logger.error`.
  - **`context/`** (RFC-004) — `ContextBuilder` assembles LLM context from pluggable modules (player-state, world-state, scenario-hint, npc-persona, npc-memory, narrative-history, active-events, intent-input). `MemoryFilter` prunes stale memories. `NarrativeHistory` manages the narrative log. Supports budget enforcement (`ContextBudgetError`).
  - **`prompts/`** (RFC-004) — `TemplateEngine` renders prompt templates with `{{variable}}` interpolation. LLM prompt schemas for GM narrative, NPC dialogue, intent classification, and event trigger define expected JSON outputs.
  - **`utils/`** — `id.ts` (uuid generation), `narrative-log.ts` (file-based narrative storage alongside SQLite).
- **`frontend/`** — React 18 + Vite. `App.tsx` switches `GameSetup` ↔ `GameScreen`; `services/api.ts` is the API client. Zustand/Tailwind appear in design docs as the target stack but are NOT installed yet — trust `package.json`, not the design text.

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
| 014 | 配置中心页面 | P0 | 进行中 |
| 007 | LLM接入：意图分类与事件触发 | P1 | 已提议 |
| 008 | 世界自主演化系统 | P1 | 已提议 |
| 009 | 事件链引擎 | P2 | 已提议 |
| 010 | 前端组件化重构 | P2 | 已提议 |
| 011 | 前端SSE与NPC对话面板 | P2 | 已提议 |
| 012 | 集成测试与验收 | P3 | 已提议 |

### RFC 完工铁律
1. `npm run dev` 成功启动，路由映射全部打印
2. `curl` 调用核心 API 返回有效响应
3. 非法请求返回结构化错误
4. execution.md 粘贴启动日志 + API 响应

## Git 纪律（提交前缀铁律）

| type | scope | 含义 | 例子 |
|------|-------|------|------|
| `feat` | `rfcNNN` | RFC 新功能 | `feat(rfc5): LLMClient 重构` |
| `fix` | `bfNNN` 或 `rfcNNN` | Bug 修复 | `fix(bf6-1): 中文化` |
| `chore` | — | 配置/依赖/清理 | `chore: config.toml` |
| `docs` | — | 文档/RFC 归档 | `docs: RFC-004 归档` |

**所有修改必须提交**，完成后立即 push，不允许长期保留未提交变更。


