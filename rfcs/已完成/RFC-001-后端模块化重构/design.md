# RFC-001: 后端模块化重构

> **状态**: 已完成
> **优先级**: P0
> **创建**: 2026-07-18

---

## 目录结构

```
backend/
  package.json                  # 新增 NestJS 依赖
  tsconfig.json
  src/
    main.ts                     # 入口：NestFactory.create(AppModule)
    app.module.ts               # 根模块，注册所有子模块
    common/                     # 跨领域共享
      filters/
        http-exception.filter.ts    # 全局异常 → APIResponse 格式
      interceptors/
        logging.interceptor.ts      # 请求日志
        llm-cost.interceptor.ts     # LLM 成本追踪
      pipes/
        zod-validation.pipe.ts      # 通用 zod 验证管道
    game/                       # 游戏会话领域
      game.module.ts
      game.controller.ts        # POST /api/game, POST /api/game/:id/action
      game.service.ts           # 创建游戏、动作路由
      game.schema.ts            # zod schema
    npc/                        # NPC 对话领域
      npc.module.ts
      npc.controller.ts         # POST /api/game/:id/npc/:npcId/talk
      npc.service.ts
      npc.schema.ts
    world/                      # 世界状态领域
      world.module.ts
      world.controller.ts       # GET /api/game/:id/world
      world.service.ts          # 世界 tick（时间/天气/NPC情绪漂移）
      world.schema.ts
    storyline/                  # 事件链领域
      storyline.module.ts
      storyline.controller.ts   # GET /api/game/:id/storyline
      storyline.service.ts      # 意图路由匹配、阶段推进
      storyline.schema.ts
    llm/                        # LLM 集成
      llm.module.ts
      client.ts                 # LLMClient（兼容 Anthropic API）
      gm-engine.ts              # GM 叙事引擎（opus）
      npc-dialogue.ts           # NPC 对话引擎（sonnet）
      intent-classifier.ts      # 意图分类（haiku）
      memory-filter.ts          # 世界记忆过滤（haiku）
      context-manager.ts        # 上下文拼接与裁剪
    config/                     # 世界配置 + 应用配置
      config.module.ts
      config.service.ts           # 统一配置服务（端口、路径、LLM）
      loader.ts                   # 从 worlds/ 目录加载配置
      validator.ts                # zod 校验配置结构
    db/                         # 数据层
      db.module.ts
      sqlite.ts                 # better-sqlite3 封装（WAL 模式）
      repositories/             # 每表一个 Repository
        game.repository.ts
        npc.repository.ts
        world.repository.ts
        player.repository.ts
        storyline.repository.ts
        llm-log.repository.ts
    utils/
      id.ts                     # UUID（已有）
      narrative-log.ts          # narrative 文件读写
```

## 模块依赖图

```
AppModule
├── CommonModule (filter/interceptor/pipe 全局注册)
├── ConfigModule (世界配置加载)
├── DbModule (SQLite + repositories)
├── LlmModule (LLMClient + 引擎 + 上下文管理)
├── GameModule → depends on: DbModule, LlmModule, NpcModule, StorylineModule, WorldModule
├── NpcModule → depends on: DbModule, LlmModule
├── WorldModule → depends on: DbModule, LlmModule
└── StorylineModule → depends on: DbModule, LlmModule
```

## 控制器路由映射

| Express 路由 | NestJS 控制器 |
|-------------|--------------|
| `POST /api/game` | `GameController.create()` |
| `POST /api/game/:id/action` | `GameController.performAction()` |
| `POST /api/game/:id/npc/:npcId/talk` | `NpcController.talk()` |
| `GET /api/game/:id/world` | `WorldController.getState()` |
| `GET /api/game/:id/storyline` | `StorylineController.getState()` |
| `GET /api/game/:id/stream/gm` | `GameController.streamGm()` (SSE) |
| `GET /api/game/:id/stream/npc/:npcId` | `GameController.streamNpc()` (SSE) |

## Zod 验证管道

```typescript
// common/pipes/zod-validation.pipe.ts
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private schema: ZodSchema) {}

  transform(value: unknown) {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        success: false,
        error: result.error.format(),
      });
    }
    return result.data;
  }
}

// 使用
@Post()
create(@Body(new ZodValidationPipe(createGameSchema)) body: CreateGameRequest) {}
```

## 异常过滤器

```typescript
// common/filters/http-exception.filter.ts
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const status = exception instanceof HttpException
      ? exception.getStatus()
      : 500;

    response.status(status).json({
      success: false,
      error: exception instanceof Error ? exception.message : 'Internal error',
    });
  }
}
```

## 配置服务

统一管理所有配置项。唯一配置源：**`~/.claude/settings.json`**。

```typescript
// config/config.service.ts
@Injectable()
export class ConfigService {
  private settings: SettingsFile | null = null;

  constructor() {
    this.load();
  }

  // 服务端口
  get port(): number { return 3001; }

  // LLM
  get llmApiKey(): string    { return this.getEnv('ANTHROPIC_AUTH_TOKEN'); }
  get llmBaseUrl(): string   { return this.getEnv('ANTHROPIC_BASE_URL') ?? 'https://api.anthropic.com'; }
  get llmOpusModel(): string   { return this.getEnv('ANTHROPIC_DEFAULT_OPUS_MODEL')   ?? 'claude-opus-4-8'; }
  get llmSonnetModel(): string { return this.getEnv('ANTHROPIC_DEFAULT_SONNET_MODEL') ?? 'claude-sonnet-4-6'; }
  get llmHaikuModel(): string  { return this.getEnv('ANTHROPIC_DEFAULT_HAIKU_MODEL')  ?? 'claude-haiku-4-5-20251001'; }

  // 路径
  get dbPath(): string      { return path.join(process.cwd(), 'data', 'talking-legend.db'); }
  get worldsDir(): string   { return path.join(process.cwd(), '..', 'worlds'); }
  get gameDataDir(): string { return path.join(process.cwd(), 'data', 'games'); }

  // ---- private ----
  private get settingsPath(): string {
    return path.join(os.homedir(), '.claude', 'settings.json');
  }

  private load(): void {
    try {
      this.settings = JSON.parse(fs.readFileSync(this.settingsPath, 'utf-8'));
    } catch {
      this.settings = null; // 骨架模式：文件不存在也不崩溃
    }
  }

  private getEnv(key: string): string | undefined {
    return this.settings?.env?.[key];
  }
}

interface SettingsFile {
  env?: Record<string, string>;
}
```

**不配 LLM key 时**: 仅 warn，不崩溃，允许骨架模式跑通。

**配置来源（`~/.claude/settings.json` 的 `env` 字段）**:
```json
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "sk-...",
    "ANTHROPIC_BASE_URL": "https://api.deepseek.com/anthropic",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "deepseek-v4-pro[1M]",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "deepseek-v4-flash[1M]",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "deepseek-v4-flash[1M]"
  }
}
```
所有 LLM 配置从此读取，不读取环境变量。

## 迁移策略

1. **安装 NestJS**: `npm i @nestjs/common @nestjs/core @nestjs/platform-express reflect-metadata rxjs`
2. **保留旧代码不动**，新建 `backend/src/` 下各模块
3. **逐模块迁移**：先 DbModule → ConfigModule → GameModule（最小可运行）→ 验证通过后再迁移其余
4. **旧文件最后删除**：`routes/game.ts`、`services/game-service.ts` 在 GameModule 稳定后移除
5. **测试同步迁**：每个模块迁移完跑对应 UT

## 替代方案

| 方案 | 排除理由 |
|------|---------|
| 保持 Express + 手动分层 | 缺乏 DI、手动中间件拼接、测试 mock 困难。后续领域增多后重构成本更高 |
| Fastify 替代 Express | NestJS 可底层切换 Fastify，当前不急着换 |

## 影响范围

- 整个 `backend/` 目录重构
- `package.json` 新增 NestJS 依赖
- `shared/src/index.ts` 类型不变
- 前端 API 调用不变（路由路径保持一致）

## 依赖

无前置 RFC。本 RFC 是所有后续 RFC 的基础。

## 不在范围

- LLM 引擎实现（RFC-005/006/007）
- SSE 流式端点（RFC-005）
- SQLite 多表（RFC-002）
- 世界配置加载（RFC-003）
- NPC/World/Storyline 模块的实际业务逻辑（仅搭骨架）
