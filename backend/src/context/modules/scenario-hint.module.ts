/**
 * RFC-004: 场景指引模块。
 * 提供 GM 叙事方向的幕后提示（可选的 GM 指导）。
 */

import { BaseContextModule } from './base.module';

export class ScenarioHintModule extends BaseContextModule {
  readonly name = 'scenario_hint';
  readonly mandatory = false;

  renderFull(): string {
    const hint = this.data.hint as string | undefined;
    if (!hint) {
      return '无特殊指引。当前为自由探索阶段。';
    }

    return `## GM 指引\n${hint}`;
  }

  renderCompact(): string {
    const hint = this.data.hint as string | undefined;
    return hint ? `指引: ${hint.slice(0, 80)}...` : '自由探索';
  }

  renderMinimal(): string {
    const hint = this.data.hint as string | undefined;
    return hint ? '有指引' : '自由';
  }
}
