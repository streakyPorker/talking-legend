# Worlds — 世界配置目录

每个子目录是一个世界，目录名即为世界 `id`。

## 目录结构

```
worlds/
  <world-id>/
    world.json          # 必需 — 世界元信息（id, name, description, startingRegion）
    regions.json        # 可选 — 区域数组（单文件整组）
    regions/            # 可选 — 每文件一个区域（文件名任意，以内容 id 为准）
      <any>.json
    npcs.json           # 可选 — NPC 数组（单文件整组）
    npcs/               # 可选 — 每文件一个 NPC（文件名任意，以内容 key 为准）
      <any>.json
```

参考实现：`aethelgard/` — 采用拆分形态（world.json + regions/*.json + npcs/*.json）。

## 三来源合并装配

`regions` 和 `npcs` 各自独立支持三种来源，loader 在启动时自动合并：

| 来源 | 形式 | 错误策略 |
|------|------|----------|
| 内联 | `world.json` 内的 `regions` / `npcs` 数组 | — |
| 单文件 | `<段>.json`（如 `regions.json`） | **全有或全无** — 一个元素校验失败则整文件丢弃 |
| 目录 | `<段>/` 下逐文件 `*.json` | **逐文件容错** — 一个文件损坏不影响其他文件 |

三种来源可任意组合，合并后按 id（region）/ key（npc）去重——**重复即为校验失败，该世界被跳过**。

> **为什么单文件和目录容错策略不同？** 单文件是一个作者单元，部分接受会静默丢失作者视为原子的内容。目录下每个文件是独立单元，不应互相连坐。

## 校验规则

合并装配后统一校验：

- `world.json` 中的 `id` **必须等于目录名**（防错位）
- `startingRegion` 必须存在于合并后的 `regions[].id`
- `connectedRegions` 引用的区域必须存在
- `npcs[].location` 必须存在于 `regions[].id`
- 合并后所有来源间 region `id` / npc `key` **无重复**

## `key` 与实例 `id`

NPC 配置中使用稳定的 `key`（人类可读、可引用）。每局游戏实例化时生成 uuid 作为 `NPCState.id`，配置 `key` 不出现在运行时实例中。

## 错误处理

| 场景 | 行为 |
|------|------|
| 单个 JSON 文件损坏 | `Logger.error`，跳过该文件 |
| 装配后校验失败 | `Logger.error` 打印全部失败原因，跳过该世界 |
| `worldsDir` 不存在 | `Logger.warn`，服务以骨架模式正常运行 |

## 部署

后端通过 `ConfigService.worldsDir` 解析此目录，优先级：

1. `WORLDS_DIR` 环境变量（显式指定）
2. `__dirname` 相对路径（自动解析到 `<repo>/worlds/`，不依赖 cwd）

改配置后需重启后端（MVP 无热加载）。
