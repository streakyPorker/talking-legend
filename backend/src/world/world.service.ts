import { Injectable, Inject } from '@nestjs/common';
import { WorldRepository } from '../db/repositories/world.repository';

@Injectable()
export class WorldService {
  constructor(
    @Inject(WorldRepository) private readonly worldRepo: WorldRepository,
  ) {}

  /**
   * 将玩家移动到目标区域。
   * 仅验证连通性 + 更新 currentRegion，调用方负责 turn bump。
   */
  async moveToRegion(gameId: string, targetRegion: string): Promise<{ fromRegion: string; narrative: string }> {
    const world = this.worldRepo.findByGameId(gameId);
    if (!world) throw new Error('游戏不存在');

    // Validate connectivity
    const currentRegion = world.regions.find((r) => r.id === world.currentRegion);
    if (!currentRegion) throw new Error('当前区域不存在');
    if (!currentRegion.connectedRegions?.includes(targetRegion)) {
      throw new Error(`无法到达 ${targetRegion}`);
    }

    const fromRegion = world.currentRegion;
    const targetRegionCfg = world.regions.find((r) => r.id === targetRegion);
    const narrative = `你离开${fromRegion}，前往${targetRegion}。${targetRegionCfg?.description ?? ''}`;

    // Update
    this.worldRepo.upsert(gameId, { ...world, currentRegion: targetRegion });

    return { fromRegion, narrative };
  }

  // Placeholder: world tick & state management (RFC-008)
}
