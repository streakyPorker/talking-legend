/**
 * RFC-004: ContextBuilder 实现。
 *
 * 按调用类型组装上下文模块，执行 trim 降级，输出 AssembledContext。
 * 四种具体 Builder 对应四种调用类型，差异仅在模块组合配置。
 */

import type { CallType, ContextModule, GatherContext, AssembledContext } from './context-module.interface';
import { DEFAULT_MODULE_CONFIG } from './module-config';
import { ContextBudgetExceededError } from './context-budget.error';

/** 模块实例 + 配置条目 */
interface ModuleSlot {
  module: ContextModule;
  mandatory: boolean;
}

export abstract class BaseContextBuilder {
  abstract readonly callType: CallType;

  /**
   * 主入口：按配置组装模块 → 渲染 → 输出 AssembledContext。
   * @param gameId 游戏 ID
   * @param budget token 预算上限（来自调用方，如 Opus 200K）
   * @param params 额外参数（如 { npcId } 用于 NPC 对话）
   */
  async build(
    gameId: string,
    budget: number,
    params?: Record<string, unknown>,
  ): Promise<AssembledContext> {
    const slots = this.resolveSlots();
    const ctx: GatherContext = {
      gameId,
      callType: this.callType,
      params,
    };

    // 并行收集所有模块数据
    const gathered = await Promise.all(
      slots.map(async (slot) => ({
        slot,
        data: await slot.module.gather(ctx),
      })),
    );

    // 先渲染强制模块（始终 full）
    const sections: string[] = [];
    let totalEstimate = 0;
    const mandatoryItems = gathered.filter((g) => g.slot.mandatory);
    const optionalItems = gathered.filter((g) => !g.slot.mandatory);

    for (const { slot, data } of mandatoryItems) {
      const text = slot.module.granularity.full(data);
      sections.push(text);
      totalEstimate += data.tokenEstimate;
    }

    // 强制模块之和已超预算 → fail fast
    if (totalEstimate > budget) {
      throw new ContextBudgetExceededError(totalEstimate, budget);
    }

    // 非强制模块：尝试 full → compact → minimal
    const remainingBudget = budget - totalEstimate;
    const { sections: optSections, estimate: optEstimate } =
      this.fitOptionalModules(optionalItems, remainingBudget);

    sections.push(...optSections);
    totalEstimate += optEstimate;

    // 所有 non-mandatory 降级到 minimal 仍超预算 → fail fast
    if (totalEstimate > budget) {
      throw new ContextBudgetExceededError(totalEstimate, budget);
    }

    const systemPrompt = sections.join('\n\n');
    return {
      systemPrompt,
      userPrompt: '', // 由调用方通过 TemplateEngine 单独渲染
      tokenEstimate: totalEstimate,
    };
  }

  /**
   * 将非强制模块按预算逐模块降级。
   * 策略：从最后一个模块开始降级，直到不溢出或全部 minimal。
   * 每次降级后重新渲染并统计实际字符数，避免估算误差。
   */
  private fitOptionalModules(
    items: Array<{ slot: ModuleSlot; data: import('./context-module.interface').ModuleData }>,
    budget: number,
  ): { sections: string[]; estimate: number } {
    const granularities: Array<'full' | 'compact' | 'minimal'> = items.map(() => 'full');

    // 从后往前逐模块降级，每步用实际渲染长度判断
    let idx = items.length - 1;
    let settled = false;
    while (!settled && idx >= 0) {
      const sections = this.renderSections(items, granularities);
      const estimate = sections.reduce((sum, s) => sum + Math.ceil(s.length / 2), 0);
      if (estimate <= budget) {
        settled = true;
        break;
      }

      // 尝试降级当前模块
      const current = granularities[idx];
      if (current === 'full') {
        granularities[idx] = 'compact';
      } else if (current === 'compact') {
        granularities[idx] = 'minimal';
      } else {
        idx--; // 已是 minimal，跳过
      }
    }

    // 最终渲染
    const sections = this.renderSections(items, granularities);
    const estimate = sections.reduce((sum, s) => sum + Math.ceil(s.length / 2), 0);

    return { sections, estimate };
  }

  private renderSections(
    items: Array<{ slot: ModuleSlot; data: import('./context-module.interface').ModuleData }>,
    granularities: Array<'full' | 'compact' | 'minimal'>,
  ): string[] {
    return items.map(({ slot, data }, i) => {
      const fn = slot.module.granularity[granularities[i]];
      return fn(data);
    });
  }

  /** 子类实现：根据 callType 提供模块实例列表 */
  protected abstract resolveSlots(): ModuleSlot[];
}

// ─── 具体 Builder ────────────────────────────────────────────

export class GMContextBuilder extends BaseContextBuilder {
  readonly callType: CallType = 'gm_narrative';

  constructor(private readonly modules: Map<string, ContextModule>) {
    super();
  }

  protected resolveSlots(): ModuleSlot[] {
    return this.resolveFromConfig('gm_narrative');
  }

  private resolveFromConfig(callType: CallType): ModuleSlot[] {
    const config = DEFAULT_MODULE_CONFIG[callType];
    return config.modules.map((entry) => {
      const mod = this.modules.get(entry.name);
      if (!mod) {
        throw new Error(
          `Module "${entry.name}" not found in registry for ${callType}`,
        );
      }
      return { module: mod, mandatory: entry.mandatory };
    });
  }
}

export class NpcContextBuilder extends BaseContextBuilder {
  readonly callType: CallType = 'npc_dialogue';

  constructor(private readonly modules: Map<string, ContextModule>) {
    super();
  }

  protected resolveSlots(): ModuleSlot[] {
    const config = DEFAULT_MODULE_CONFIG['npc_dialogue'];
    return config.modules.map((entry) => {
      const mod = this.modules.get(entry.name);
      if (!mod) {
        throw new Error(
          `Module "${entry.name}" not found in registry for npc_dialogue`,
        );
      }
      return { module: mod, mandatory: entry.mandatory };
    });
  }
}

export class IntentContextBuilder extends BaseContextBuilder {
  readonly callType: CallType = 'intent_classify';

  constructor(private readonly modules: Map<string, ContextModule>) {
    super();
  }

  protected resolveSlots(): ModuleSlot[] {
    const config = DEFAULT_MODULE_CONFIG['intent_classify'];
    return config.modules.map((entry) => {
      const mod = this.modules.get(entry.name);
      if (!mod) {
        throw new Error(
          `Module "${entry.name}" not found in registry for intent_classify`,
        );
      }
      return { module: mod, mandatory: entry.mandatory };
    });
  }
}

export class EventContextBuilder extends BaseContextBuilder {
  readonly callType: CallType = 'event_trigger';

  constructor(private readonly modules: Map<string, ContextModule>) {
    super();
  }

  protected resolveSlots(): ModuleSlot[] {
    const config = DEFAULT_MODULE_CONFIG['event_trigger'];
    return config.modules.map((entry) => {
      const mod = this.modules.get(entry.name);
      if (!mod) {
        throw new Error(
          `Module "${entry.name}" not found in registry for event_trigger`,
        );
      }
      return { module: mod, mandatory: entry.mandatory };
    });
  }
}
