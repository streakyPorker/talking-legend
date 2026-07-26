/**
 * RFC-004: NPC 记忆分级过滤器。
 *
 * 三级记忆模型：
 *   important → 永久保留原文，不截断
 *   normal    → 保留最近 N 条（默认 10）
 *   trivial   → 不存原文到 context，仅计数摘要
 *
 * 分级判断由 Haiku 在写入时完成；本模块负责读取时的过滤与渲染。
 */

export interface ClassifiedMemory {
  id: number;
  npcId: string;
  content: string;
  turn: number;
  tier: 'important' | 'normal' | 'trivial';
  createdAt: string;
}

export interface FilteredMemories {
  important: ClassifiedMemory[];
  normal: ClassifiedMemory[];
  trivialCount: number;
}

export interface MemoryClassification {
  tier: 'important' | 'normal' | 'trivial';
  content: string;
}

export class MemoryFilter {
  /** normal 记忆保留条数 */
  private readonly normalLimit: number;

  constructor(normalLimit = 10) {
    this.normalLimit = normalLimit;
  }

  /**
   * 分类一段新记忆。简化实现（不依赖 Haiku）：
   * 基于启发式规则做默认分级，后续替换为 LLM 调用。
   * 失败时返回 'normal'（降级安全）。
   */
  classifyMemory(content: string, _context?: string): MemoryClassification {
    try {
      const tier = this.heuristicClassify(content);
      return { tier, content };
    } catch {
      // 降级安全：任何异常都 fallback 到 normal
      return { tier: 'normal', content };
    }
  }

  /**
   * 启发式分级（临时方案，后续替换为 Haiku）。
   * 规则：
   *   - 含 "背叛"/"救命"/"秘密"/"真相" → important
   *   - 含 "你好"/"再见"/"谢谢"/"天气" → trivial
   *   - 其余 → normal
   */
  private heuristicClassify(content: string): 'important' | 'normal' | 'trivial' {
    const importantKeywords = ['背叛', '救命', '秘密', '真相', '威胁', '诅咒', '宝藏'];
    const trivialKeywords = ['你好', '再见', '谢谢', '天气', '今天', '吃'];

    const lower = content.toLowerCase();
    if (importantKeywords.some((k) => lower.includes(k))) return 'important';
    if (trivialKeywords.some((k) => lower.includes(k))) return 'trivial';
    return 'normal';
  }

  /**
   * 从全量记忆中过滤出应带入 context 的内容。
   *   important → 全量
   *   normal    → 最近 N 条（按 turn 倒序）
   *   trivial   → 仅计数
   */
  filterForContext(memories: ClassifiedMemory[]): FilteredMemories {
    const important = memories.filter((m) => m.tier === 'important');

    const normalAll = memories
      .filter((m) => m.tier === 'normal')
      .sort((a, b) => b.turn - a.turn);

    const normal = normalAll.slice(0, this.normalLimit);

    const trivialCount = memories.filter((m) => m.tier === 'trivial').length;

    return { important, normal, trivialCount };
  }

  /**
   * 将过滤后的记忆渲染为 prompt 文本块。
   */
  renderContextSummary(filtered: FilteredMemories): string {
    const lines: string[] = [];

    for (const m of filtered.important) {
      lines.push(`- [重要] ${m.content}（第${m.turn}轮）`);
    }
    for (const m of filtered.normal) {
      lines.push(`- [普通] ${m.content}（第${m.turn}轮）`);
    }
    if (filtered.trivialCount > 0) {
      lines.push(`- 还有 ${filtered.trivialCount} 段日常对话未列出`);
    }

    if (lines.length === 0) return '暂无记忆';

    return lines.join('\n');
  }
}
