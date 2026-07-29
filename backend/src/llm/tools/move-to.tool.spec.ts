import { describe, it, expect } from 'vitest';
import { createMoveToTool } from './move-to.tool';
import type { GameTool } from '../tool.interface';

describe('createMoveToTool', () => {
  const mockGameService = {
    moveToRegion: async (_gameId: string, target: string) => ({
      success: true,
      message: `到达${target}`,
      narrative: `你来到了${target}。`,
      gameState: { turn: 2, phase: 'exploration' },
    }),
  } as never;

  it('should return a GameTool with correct name', () => {
    const tool = createMoveToTool(mockGameService);
    expect(tool.name).toBe('moveTo');
  });

  it('should have description mentioning movement', () => {
    const tool = createMoveToTool(mockGameService);
    expect(tool.description).toContain('移动');
  });

  it('should declare target as required in input_schema', () => {
    const tool = createMoveToTool(mockGameService);
    const schema = tool.input_schema as { required?: string[] };
    expect(schema.required).toContain('target');
  });

  it('should execute move and return success with stateChanges', async () => {
    const tool = createMoveToTool(mockGameService);
    const result = await tool.execute('game-1', { target: 'forest' });
    expect(result.success).toBe(true);
    expect(result.stateChanges).toBeDefined();
    expect(result.stateChanges!.gameState).toBeDefined();
  });

  it('should return failure when target is missing', async () => {
    const failingService = {
      moveToRegion: async () => {
        throw new Error('should not be called');
      },
    } as never;
    const tool = createMoveToTool(failingService);
    const result = await tool.execute('game-1', {});
    expect(result.success).toBe(false);
    expect(result.message).toContain('缺少');
  });

  it('should catch service errors gracefully', async () => {
    const errorService = {
      moveToRegion: async () => {
        throw new Error('连接失败');
      },
    } as never;
    const tool = createMoveToTool(errorService);
    const result = await tool.execute('game-1', { target: 'forest' });
    expect(result.success).toBe(false);
    expect(result.message).toContain('移动失败');
    expect(result.message).toContain('连接失败');
  });

  it('should pass gameId and target to gameService', async () => {
    let capturedGameId = '';
    let capturedTarget = '';
    const capturingService = {
      moveToRegion: async (gameId: string, target: string) => {
        capturedGameId = gameId;
        capturedTarget = target;
        return { success: true, message: 'ok', narrative: '', gameState: { turn: 1 } };
      },
    } as never;
    const tool = createMoveToTool(capturingService);
    await tool.execute('my-game', { target: 'lake' });
    expect(capturedGameId).toBe('my-game');
    expect(capturedTarget).toBe('lake');
  });
});
