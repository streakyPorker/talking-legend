# RFC-002: SQLite 多表持久化

> **状态**: 正在进行
> **优先级**: P0
> **创建**: 2026-07-18

## 问题

RFC-001 完成 NestJS 模块化重构后，`DbModule` 仍使用 `Map<string, Map<string, unknown>>` 作为内存骨架。所有 6 个 Repository 均为空壳，`GameService` 绕过 Repository 直接操作私有 `Map` 实例。

核心痛点：

1. **无持久化**：服务重启丢失所有游戏数据
2. **无事务**：多表写操作无原子性保障
3. **无查询能力**：Map 只能按 key 查找，无法做关联查询（如"某个 NPC 的所有记忆"）
4. **绕过 Repository**：Repository 层形同虚设，数据访问分散在各 Service 中
5. **无 schema 约束**：Map 可容纳任意结构，开发和调试时无声 bug 多

## 动机

RFC-002 是第一个"填肉"RFC——将内存存储替换为 `better-sqlite3`，打通真正的持久化链路。这是后续所有游戏功能（世界演化、NPC 记忆、事件链、LLM 日志）的数据基础。
