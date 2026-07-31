# Talking Legend

LLM 原生文字冒险游戏 —— 你的话语塑造世界。世界演化与 NPC 对话由大模型驱动。

## 技术栈

- **frontend/** — React 18 + Vite + TailwindCSS v4 + daisyUI 5
- **backend/** — NestJS 11 + better-sqlite3（单端口托管前端静态文件）
- **shared/** — 前后端共享的 TypeScript 类型与 API 契约
- **worlds/** — 世界配置文件（JSON）

## 快速开始

要求 Node.js >= 18。

```bash
npm install
npm start
```

构建 + 启动后访问 http://localhost:31943。

> `npm start` / `npm run restart` 每次会删除 `backend/data/talking-legend.db`。开发调试用 `npm run dev`（保留数据库）。

常用命令见 `CLAUDE.md`。

## 配置

LLM 配置不走 `.env`。优先级：环境变量 > `~/.claude/settings.json`（env 块）> `config.toml` > 默认值。完整模板见 `config.default.toml`。

## 文档

项目状态、架构、RFC 进度、命令表统一维护在 **`CLAUDE.md`**（本文档保持精简，发布时再补全）。
