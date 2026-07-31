import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { WorldRepository } from '../db/repositories/world.repository';

@Injectable()
export class WorldService {
  constructor(
    @Inject(WorldRepository) private readonly worldRepo: WorldRepository,
  ) {}

  /**
   * 移动校验 + 叙事生成（只读，不写库）。
   * 仅验证连通性并生成叙事文案；世界状态写库由 GameService 在 db.transaction 内
   * 通过 WorldRepository.upsert 完成（见 #5 单事务化契约）。
   */
  async moveToRegion(gameId: string, targetRegion: string): Promise<{ fromRegion: string; targetName: string; narrative: string }> {
    const world = this.worldRepo.findByGameId(gameId);
    if (!world) throw new BadRequestException('游戏不存在');

    // Validate connectivity
    const currentRegion = world.regions.find((r) => r.id === world.currentRegion);
    if (!currentRegion) throw new BadRequestException('当前区域不存在');
    if (!currentRegion.connectedRegions?.includes(targetRegion)) {
      throw new BadRequestException(`无法到达 ${targetRegion}`);
    }

    const fromRegion = world.currentRegion;
    const fromRegionName = currentRegion.name;
    const targetRegionCfg = world.regions.find((r) => r.id === targetRegion);
    const targetName = targetRegionCfg?.name ?? targetRegion;
    const narrative = `你离开了${fromRegionName}，前往${targetName}。${targetRegionCfg?.description ?? ''}`;

    return { fromRegion, targetName, narrative };
  }

  // Placeholder: world tick & state management (RFC-008)
}
