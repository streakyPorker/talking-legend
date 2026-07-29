import { describe, it, expect, beforeEach } from 'vitest';
import { ToolRegistry } from './tool-registry';
import type { GameTool } from './tool.interface';

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  describe('register', () => {
    it('should register a tool and make it available for LLM', () => {
      const tool: GameTool = {
        name: 'testTool',
        description: 'A test tool',
        input_schema: { type: 'object', properties: {} },
        execute: async () => ({ success: true, message: 'ok' }),
      };
      registry.register(tool);

      const tools = registry.getToolsForLLM();
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('testTool');
      expect(tools[0].description).toBe('A test tool');
      expect(tools[0].input_schema).toEqual({ type: 'object', properties: {} });
    });

    it('should register multiple tools', () => {
      const tool1: GameTool = {
        name: 'tool1',
        description: 'First',
        input_schema: {},
        execute: async () => ({ success: true, message: 'ok' }),
      };
      const tool2: GameTool = {
        name: 'tool2',
        description: 'Second',
        input_schema: {},
        execute: async () => ({ success: true, message: 'ok' }),
      };
      registry.register(tool1);
      registry.register(tool2);

      expect(registry.getToolsForLLM()).toHaveLength(2);
    });

    it('should overwrite a previously registered tool with the same name', () => {
      const tool1: GameTool = {
        name: 'dupTool',
        description: 'First version',
        input_schema: {},
        execute: async () => ({ success: true, message: 'v1' }),
      };
      const tool2: GameTool = {
        name: 'dupTool',
        description: 'Second version',
        input_schema: {},
        execute: async () => ({ success: true, message: 'v2' }),
      };
      registry.register(tool1);
      registry.register(tool2);

      const tools = registry.getToolsForLLM();
      expect(tools).toHaveLength(1);
      expect(tools[0].description).toBe('Second version');
    });
  });

  describe('getToolsForLLM', () => {
    it('should return an empty array when no tools are registered', () => {
      expect(registry.getToolsForLLM()).toEqual([]);
    });

    it('should return tools without execute functions (LLM-safe shape)', () => {
      const tool: GameTool = {
        name: 'safeTool',
        description: 'Safe for LLM',
        input_schema: {},
        execute: async () => ({ success: true, message: 'ok' }),
      };
      registry.register(tool);

      const tools = registry.getToolsForLLM();
      // The returned objects should NOT have the execute property
      expect('execute' in tools[0]).toBe(false);
      expect(Object.keys(tools[0]).sort()).toEqual(['description', 'input_schema', 'name']);
    });
  });

  describe('execute', () => {
    it('should execute a registered tool with arguments', async () => {
      const tool: GameTool = {
        name: 'testTool',
        description: 'test',
        input_schema: {},
        execute: async (gameId, args) => ({
          success: true,
          message: `done ${args.x}`,
          stateChanges: { region: args.x },
        }),
      };
      registry.register(tool);

      const result = await registry.execute('testTool', 'g1', { x: 'forest' });
      expect(result.success).toBe(true);
      expect(result.message).toBe('done forest');
      expect(result.stateChanges).toEqual({ region: 'forest' });
    });

    it('should return failure for unknown tool', async () => {
      const result = await registry.execute('unknownTool', 'g1', {});
      expect(result.success).toBe(false);
      expect(result.message).toContain('未知工具');
    });

    it('should handle tool execution errors gracefully', async () => {
      const tool: GameTool = {
        name: 'brokenTool',
        description: 'broken',
        input_schema: {},
        execute: async () => {
          throw new Error('oops');
        },
      };
      registry.register(tool);

      const result = await registry.execute('brokenTool', 'g1', {});
      expect(result.success).toBe(false);
      expect(result.message).toContain('oops');
    });
  });
});
