/**
 * RFC-004: 上下文模块接口契约
 *
 * ContextModule 是可插拔的上下文数据源，每个模块负责从特定来源
 * (DB/文件/参数) 收集数据并渲染为 prompt 文本。
 */

/** LLM 调用类型 */
export type CallType = 'gm_narrative' | 'npc_dialogue' | 'intent_classify' | 'event_trigger';

/** gather() 的上下文参数 */
export interface GatherContext {
  gameId: string;
  callType: CallType;
  params?: Record<string, unknown>;
}

/** 模块收集的结构化数据 + token 估算 */
export interface ModuleData {
  structured: Record<string, unknown>;
  /** 粗略 token 估算（字符数/2），仅用于 trim 决策和日志 */
  tokenEstimate: number;
}

/** 三种渲染粒度（非强制模块必须提供；强制模块可省略 compact/minimal） */
export interface Granularity {
  /** 完整详情，等价于 render() */
  full(data: ModuleData): string;
  /** 精简摘要（约 1/3 长度） */
  compact(data: ModuleData): string;
  /** 一行关键词 */
  minimal(data: ModuleData): string;
}

/**
 * 上下文模块接口。
 * 每个模块负责单一数据来源的收集与格式化。
 */
export interface ContextModule {
  /** 唯一标识，如 'world_state' */
  readonly name: string;
  /** 是否强制（不可裁剪、不可降级粒度） */
  readonly mandatory: boolean;

  /** 从数据源收集数据 */
  gather(ctx: GatherContext): Promise<ModuleData>;

  /** 默认渲染为 prompt 文本（等价于 granularity.full） */
  render(data: ModuleData): string;

  /** 粒度降级方法 */
  granularity: Granularity;

  /** 传入自定义模板覆盖默认渲染 */
  renderWith(data: ModuleData, template: string): string;
}

/** ContextBuilder.build() 的输出 */
export interface AssembledContext {
  systemPrompt: string;
  userPrompt: string;
  /** 粗略 token 估算（仅日志/监控用） */
  tokenEstimate: number;
}

/** 模块配置中的单条入口 */
export interface ModuleEntry {
  name: string;
  mandatory: boolean;
}

/** 一个调用类型的模块配置 */
export interface ModuleConfig {
  modules: ModuleEntry[];
}
