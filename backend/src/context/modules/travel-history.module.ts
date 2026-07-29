import type { ContextModule, ModuleData, Granularity, GatherContext } from '../context-module.interface';
import { TravelLogRepository } from '../../db/repositories/travel-log.repository';

export class TravelHistoryModule implements ContextModule {
  readonly name = 'travel_history';
  readonly mandatory = false;

  private travelLogRepo: TravelLogRepository;

  constructor(travelLogRepo: TravelLogRepository) {
    this.travelLogRepo = travelLogRepo;
  }

  async gather(ctx: GatherContext): Promise<ModuleData> {
    const entries = this.travelLogRepo.getRecent(ctx.gameId, 5);
    const tokenEstimate = entries.length * 30;

    return {
      structured: { entries: entries.map((e) => ({ from: e.fromRegion, to: e.toRegion, turn: e.turn, trigger: e.trigger })) },
      tokenEstimate,
    };
  }

  render(data: ModuleData): string {
    return this.granularity.full(data);
  }

  renderWith(data: ModuleData, _template: string): string {
    return this.granularity.full(data);
  }

  granularity: Granularity = {
    full: (data: ModuleData) => {
      const entries = data.structured.entries as Array<{ from: string; to: string; turn: number; trigger: string }>;
      if (entries.length === 0) return '移动历史: 无';
      const list = entries.map((e) => `${e.from}→${e.to}(第${e.turn}回合,${e.trigger === 'click' ? '点击' : '对话'})`).join(', ');
      return `移动历史: ${list}`;
    },
    compact: (data: ModuleData) => {
      const entries = data.structured.entries as Array<{ from: string; to: string }>;
      if (entries.length === 0) return '移动: 无';
      const regions: string[] = [];
      for (const e of entries) {
        if (regions.length === 0) regions.push(e.from);
        regions.push(e.to);
      }
      return `移动: ${regions.join('→')}`;
    },
    minimal: (data: ModuleData) => {
      const entries = data.structured.entries as Array<{ from: string; to: string }>;
      if (entries.length === 0) return '';
      return `最近移动: ${entries[entries.length - 1].from}→${entries[entries.length - 1].to}`;
    },
  };
}
