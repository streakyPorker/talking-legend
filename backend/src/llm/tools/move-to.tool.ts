import type { GameTool, ToolResult } from '../tool.interface';
import type { GameService } from '../../game/game.service';

/** moveTo tool — 将玩家移动到相邻区域 */
export function createMoveToTool(gameService: GameService): GameTool {
  return {
    name: 'moveTo',
    description: '将玩家移动到相邻的目标区域。只能移动到当前区域直接连接的区域。',
    input_schema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: '目标区域ID（如 forest、lake、mountains、village）',
        },
      },
      required: ['target'],
    },
    execute: async (gameId: string, args: Record<string, unknown>): Promise<ToolResult> => {
      const target = args.target as string;
      if (!target) {
        return { success: false, message: '缺少目标区域参数' };
      }

      try {
        const result = await gameService.moveToRegion(gameId, target, 'dialogue');
        return {
          success: true,
          message: result.message,
          stateChanges: { gameState: result.gameState },
        };
      } catch (err) {
        return { success: false, message: `移动失败: ${(err as Error).message}` };
      }
    },
  };
}
