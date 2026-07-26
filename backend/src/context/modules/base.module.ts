/**
 * RFC-004: ContextModule 基类。
 * 减少模块实现的样板代码，提供默认的 gather/renderWith/granularity 实现。
 */

import type { ContextModule, GatherContext, Granularity, ModuleData } from '../context-module.interface';

export abstract class BaseContextModule implements ContextModule {
  abstract readonly name: string;
  abstract readonly mandatory: boolean;

  /** 模块内部缓存的数据，由子类通过 setData() 写入 */
  protected data: Record<string, unknown> = {};

  /** 预填充模块数据（供外部调用方在 gather 前注入） */
  setData(data: Record<string, unknown>): void {
    this.data = data;
  }

  /** 默认实现：返回 setData 注入的数据 */
  async gather(_ctx: GatherContext): Promise<ModuleData> {
    const text = this.renderFull();
    return {
      structured: { ...this.data },
      tokenEstimate: Math.ceil(text.length / 2),
    };
  }

  /** 默认渲染（等价于 granularity.full） */
  render(data: ModuleData): string {
    this.data = data.structured;
    return this.renderFull();
  }

  /** 使用自定义模板渲染 */
  renderWith(data: ModuleData, template: string): string {
    // 简单模板替换：将 structured 的 key 替换到模板中
    let result = template;
    for (const [key, value] of Object.entries(data.structured)) {
      result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(value ?? ''));
    }
    return result;
  }

  /** 子类实现：默认（全量）渲染逻辑 */
  abstract renderFull(): string;

  /** 子类可选覆盖：精简摘要 */
  renderCompact(): string {
    return this.renderFull();
  }

  /** 子类可选覆盖：一行关键词 */
  renderMinimal(): string {
    return this.renderFull();
  }

  get granularity(): Granularity {
    return {
      full: () => this.renderFull(),
      compact: () => this.renderCompact(),
      minimal: () => this.renderMinimal(),
    };
  }
}
