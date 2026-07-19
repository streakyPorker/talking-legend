# RFC-001: 后端模块化重构

> **状态**: 已完成
> **优先级**: P0
> **创建**: 2026-07-18

---

## 问题

当前后端是单文件 Express 应用（`backend/src/index.ts` + `routes/game.ts` + `services/game-service.ts`），平铺结构。后续要接入 GM 引擎、NPC 对话、世界演化、事件链等多个领域，平铺结构会导致：

- 所有逻辑堆在少数文件里，单文件快速膨胀
- 没有依赖注入，模块间硬 import，测试时难以 mock
- 中间件（日志、错误处理、成本追踪）手动拼接
- 请求验证靠手写 if/throw，无统一 schema

## 方案

迁移到 **NestJS**，利用其模块系统和依赖注入天然支持领域拆分。

详见 [design.md](./design.md)。
