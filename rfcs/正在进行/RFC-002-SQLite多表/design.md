# RFC-002: SQLite 多表持久化

> **状态**: 正在进行
> **优先级**: P0
> **创建**: 2026-07-18

## 技术选型：better-sqlite3

| 候选 | 排除理由 |
|------|---------|
| `better-sqlite3` | 同步 API，与 NestJS 同步执行模型天然适配；WAL 模式读并发优秀 |
| `sql.js` | WASM 版本，性能不及原生；主要在浏览器场景使用 |
| `sqlite3` (node-sqlite3) | 异步回调式 API，需要额外包装为 Promise，不如同步方案简洁 |
| PostgreSQL / MySQL | 引入外部依赖，破坏"零运维启动"的设计目标 |

**关键配置**：
- 启用 WAL 模式（读写并发）
- `journal_mode = WAL`
- `synchronous = NORMAL`（WAL 模式下安全 + 性能最优）
- `foreign_keys = ON`

## 数据表设计

ER 关系概览（6 张核心表 + 2 张子表）：

```
games ──1:N──> npcs
games ──1:1──> worlds
games ──1:1──> players
games ──1:1──> storylines
games ──1:N──> llm_logs
npcs   ──1:N──> npc_memories
players──1:N──> player_quests
```

### 1. `games` — 游戏会话主表

```sql
CREATE TABLE games (
  id          TEXT PRIMARY KEY,         -- UUID
  player_name TEXT NOT NULL,
  turn        INTEGER NOT NULL DEFAULT 0,
  phase       TEXT NOT NULL DEFAULT 'intro',  -- GamePhase
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 2. `worlds` — 世界状态（1:1 games）

```sql
CREATE TABLE worlds (
  game_id         TEXT PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL,
  current_region  TEXT NOT NULL,
  time_of_day     TEXT NOT NULL DEFAULT 'morning',
  weather         TEXT NOT NULL DEFAULT 'clear',
  regions         TEXT NOT NULL,        -- JSON array of Region
  global_events   TEXT NOT NULL DEFAULT '[]', -- JSON array of string
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
```

`regions` 字段存储为 JSON 文本。不单独建 `regions` 表——regions 是世界的子属性，始终随 world 一起读写，拆分无收益。SQLite 支持 `json_extract` 做路径查询。

### 3. `npcs` — NPC 状态（1:N games）

```sql
CREATE TABLE npcs (
  id               TEXT PRIMARY KEY,    -- UUID
  game_id          TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  role             TEXT NOT NULL,
  personality      TEXT NOT NULL,
  current_mood     TEXT NOT NULL DEFAULT 'neutral',
  location         TEXT NOT NULL,
  is_alive         INTEGER NOT NULL DEFAULT 1,  -- boolean
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_npcs_game_id ON npcs(game_id);
```

对 NPC 按 game_id 做常规索引，支持"同一游戏下所有 NPC"查询。

### 4. `npc_memories` — NPC 对玩家的记忆（1:N npcs）

```sql
CREATE TABLE npc_memories (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  npc_id    TEXT NOT NULL REFERENCES npcs(id) ON DELETE CASCADE,
  content   TEXT NOT NULL,              -- 记忆内容
  turn      INTEGER NOT NULL,           -- 产生时的 turn 数
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_npc_memories_npc_id ON npc_memories(npc_id);
```

从 `memoryOfPlayer: string[]` 拆成独立表。随着游戏推进，NPC 记忆会增长，独立表支持按 npc_id 高效索引 + 按 turn 排序，避免 JSON 数组导致的 npc 行膨胀。

### 5. `players` — 玩家状态（1:1 games）

```sql
CREATE TABLE players (
  game_id     TEXT PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  location    TEXT NOT NULL,
  inventory   TEXT NOT NULL DEFAULT '[]',      -- JSON array of string
  reputation  TEXT NOT NULL DEFAULT '{}',      -- JSON object: Record<string, number>
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 6. `player_quests` — 玩家任务（1:N players）

```sql
CREATE TABLE player_quests (
  id          TEXT PRIMARY KEY,         -- quest UUID
  game_id     TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active', -- 'active' | 'completed' | 'failed'
  progress    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_player_quests_game_id ON player_quests(game_id);
```

quest 归属语义：`game_id` 直接引用 `games` 而非通过 `players` 间接关联。当前架构中 game 与 player 是 1:1 关系（每个游戏只有一个玩家角色），`game_id` 同时唯一标识一个 player。如果未来支持多人游戏（一 game 多 player），需增加 `player_id` 列并建立到 `players` 的 FK——这是已知演进点，不在本 RFC 范围。

### 7. `storylines` — 事件链状态（1:1 games）

```sql
CREATE TABLE storylines (
  game_id          TEXT PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  current_stage    TEXT NOT NULL,           -- 当前阶段标识
  stage_data       TEXT NOT NULL DEFAULT '{}', -- JSON: 阶段相关数据
  completed_stages TEXT NOT NULL DEFAULT '[]', -- JSON array of string
  active_events    TEXT NOT NULL DEFAULT '[]', -- JSON array of active event IDs
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 8. `llm_logs` — LLM 调用日志（1:N games）

```sql
CREATE TABLE llm_logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id       TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  call_type     TEXT NOT NULL,            -- 'gm' | 'npc_dialogue' | 'intent' | 'memory_filter'
  model         TEXT NOT NULL,
  prompt_tokens  INTEGER NOT NULL,
  completion_tokens INTEGER NOT NULL,
  latency_ms    INTEGER NOT NULL,
  cost_usd      REAL NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_llm_logs_game_id ON llm_logs(game_id);
CREATE INDEX idx_llm_logs_call_type ON llm_logs(call_type);
CREATE INDEX idx_llm_logs_created_at ON llm_logs(created_at);
CREATE INDEX idx_llm_logs_game_type ON llm_logs(game_id, call_type);
```

## Row 类型定义（数据访问层边界）

每个表对应一个 TypeScript Row 接口，字段类型直接映射 SQLite 列类型（`string | number | null`）。JSON 列以 `string` 存储，序列化/反序列化在 Repository 层完成。

文件位置：`backend/src/db/rows.ts`

```typescript
export interface GameRow {
  id: string;
  player_name: string;
  turn: number;
  phase: string;
  created_at: string;
  updated_at: string;
}

export interface WorldRow {
  game_id: string;
  name: string;
  description: string;
  current_region: string;
  time_of_day: string;
  weather: string;
  regions: string;          // JSON: Region[]
  global_events: string;    // JSON: string[]
  created_at: string;
  updated_at: string;
}

export interface NPCRow {
  id: string;
  game_id: string;
  name: string;
  role: string;
  personality: string;
  current_mood: string;
  location: string;
  is_alive: number;         // SQLite boolean → 0|1
  created_at: string;
  updated_at: string;
}

export interface NPCMemoryRow {
  id: number;
  npc_id: string;
  content: string;
  turn: number;
  created_at: string;
}

export interface PlayerRow {
  game_id: string;
  name: string;
  location: string;
  inventory: string;        // JSON: string[]
  reputation: string;       // JSON: Record<string, number>
  created_at: string;
  updated_at: string;
}

export interface PlayerQuestRow {
  id: string;
  game_id: string;
  title: string;
  description: string;
  status: string;
  progress: number;
  created_at: string;
  updated_at: string;
}

export interface StorylineRow {
  game_id: string;
  current_stage: string;
  stage_data: string;       // JSON: Record<string, unknown>
  completed_stages: string; // JSON: string[]
  active_events: string;    // JSON: string[]
  created_at: string;
  updated_at: string;
}

export interface LLMLogRow {
  id: number;
  game_id: string;
  call_type: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  latency_ms: number;
  cost_usd: number;
  created_at: string;
}
```

## 序列化边界约定

```
调用层（GameService 等）
    ↓ 使用 Domain 类型（来自 shared/）
Repository 层
    ↓ JSON.parse / JSON.stringify + Domain → Row 映射
SQLite（Row 类型）
```

- Repository 的公开方法签名全部使用 Domain 类型（`GameState`、`WorldState`、`NPCState` 等）
- Repository 内部在 insert/update 时将 Domain 类型映射为 Row 类型并序列化 JSON 字段
- 反序列化时填充默认值（新字段 = 默认值为预期行为）
- 不引入单独的 Mapper 层——8 张表的映射逻辑足够简单

## Schema 迁移策略

使用 schema version 表 + 顺序迁移，不引入 ORM：

```sql
CREATE TABLE IF NOT EXISTS _schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

启动时检查 `_schema_version`，按版本号顺序执行未应用的 DDL。

### Migration 生命周期规范

1. **事务包裹**：每个版本的 DDL 在 `BEGIN IMMEDIATE` / `COMMIT` 内执行。任一条语句失败则整体回滚。
2. **失败处理**：migration 失败时 `_schema_version` 不递增。下次服务启动时自动重试同一版本。错误信息写入 stderr。
3. **ALTER TABLE 边界**：v1 仅做 `CREATE TABLE`。后续版本优先使用 CREATE 新表 + 数据迁移 + DROP 旧表策略；`ALTER TABLE` 仅在 SQLite 支持的简单操作（`ADD COLUMN`、`RENAME COLUMN`、`RENAME TABLE`）中使用。
4. **幂等性**：`IF NOT EXISTS` 确保重复执行安全。
5. **单实例假设**：单机部署，`BEGIN IMMEDIATE` 提供文件级排他锁。

文件位置：`backend/src/db/migrate.ts`

## Repository 模式

每个 Repository 遵循统一模式：

```typescript
@Injectable()
export class GameRepository {
  constructor(@Inject(DB_INSTANCE) private readonly db: Database.Database) {}

  findById(id: string): GameState | undefined { ... }
  create(id: string, playerName: string): GameState { ... }
  delete(id: string): void { ... }
  list(): GameState[] { ... }
}
```

- 所有方法为同步调用（`better-sqlite3` 同步 API）
- 公开方法签名使用 Domain 类型
- Row ↔ Domain 映射在 Repository 私有方法中完成
- 使用 `db.prepare(sql)` + 参数绑定，避免 SQL 注入
- Repository 不处理业务逻辑，仅做数据访问
- `llm_log` Repository 额外提供聚合查询：按 game/type/时间范围聚合 token 和费用

## 事务策略（并发安全）

`better-sqlite3` 同步单连接——Node.js 事件循环允许两个 async 请求交替执行 JS 代码，存在读-改-写竞态窗口：

```
Request A: read turn=5 → (await something) → write turn=6
Request B: read turn=5 → (await something) → write turn=6  // 丢失 A 的更新
```

**缓解方案**：

1. `performAction()` 及其他多步写操作包裹在 `db.transaction()` 中执行
2. `db.transaction()` 回调内禁止任何 async 操作（包括 await LLM 调用、网络请求）
3. 未来如需在事务中调用 LLM（RFC-005），采用两阶段模式：
   - 阶段 1（事务内）：读 DB + 锁行
   - 阶段 2（事务外）：调用 LLM
   - 阶段 3（事务内）：写回 + 解锁
4. 短期防御层：乐观锁（`UPDATE ... WHERE turn = ?` 检查 `changes`）

## DbModule 重构

```typescript
@Global()
@Module({})
export class DbModule {
  static forRoot(config: DbModuleConfig): DynamicModule {
    const db = new Database(config.dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('foreign_keys = ON');
    migrate(db);

    const dbProvider = {
      provide: DB_INSTANCE,
      useValue: db,
    };

    return {
      module: DbModule,
      providers: [dbProvider],
      exports: [dbProvider],
    };
  }
}
```

`DB_INSTANCE` token 类型从 `Map<string, Map<string, unknown>>` 变为 `Database`（`better-sqlite3.Database`）。

## 目录结构

```
backend/src/db/
  db.module.ts           # 改用 better-sqlite3，启动时执行 migration
  sqlite.ts              # 移除（不再需要 createDb 占位函数）
  migrate.ts             # NEW: schema version 检查 + DDL 执行
  rows.ts                # NEW: 所有表的 Row 接口定义
  test-utils.ts          # NEW: createTestDb() 测试辅助函数
  repositories/
    game.repository.ts    # 实现 CRUD
    npc.repository.ts     # 实现 CRUD + 记忆管理
    world.repository.ts   # 实现 CRUD
    player.repository.ts  # 实现 CRUD + 任务管理
    storyline.repository.ts # 实现 CRUD
    llm-log.repository.ts  # 实现 CRUD + 聚合查询
```

## 测试策略

使用真实 SQLite in-memory DB（`:memory:`），而非 mock Database 实例：

1. **Repository 测试**：每个测试创建新的 Database 实例并执行 migration
2. **GameService 测试**：注入真实 Repository（连接到 `:memory:` DB），做轻量集成测试
3. **DbModule.forRoot()** 支持 `dbPath: ':memory:'` 用于测试注入

测试辅助函数（`backend/src/db/test-utils.ts`）：

```typescript
export function createTestDb(): Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}
```

## JSON 字段 Schema 演进策略

`regions`、`inventory`、`reputation`、`stage_data` 等 JSON TEXT 字段，当对应 TypeScript 接口新增字段时：

- 接受"新字段 = 默认值"为预期行为，Repository 在反序列化时负责填充默认值
- 新增字段必须可空或有合理默认值——不对存量数据执行 JSON 迁移脚本
- 如果某字段的默认值无法合理定义，则不应作为 JSON 存储，而应独立成列或独立成表
- 不在 JSON 根对象中嵌入版本号（`_v`）——当前规模下版本号管理成本超过收益
- 如果将来 JSON 结构发生破坏性变更，通过标准 migration（ALTER TABLE + UPDATE 批量重写 JSON）处理

## 替代方案

| 方案 | 排除理由 |
|------|---------|
| Prisma | 需要生成客户端代码 + migration 文件，对 8 张表过度工程化。异步 API 需额外适配 |
| TypeORM | 装饰器实体定义 + 异步 API，同样过度 |
| Knex.js | query builder 仅在 SQL 动态拼接复杂时有用；本项目查询简单，直接写 SQL 更清晰 |
| 保持 Map + JSON 文件 dump | 无并发控制、无事务、无查询能力；唯一优势是零依赖，但不满足持久化需求 |
