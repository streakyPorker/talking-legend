import { Injectable } from '@nestjs/common';
import { LegendLogger } from '../common/logger/legend.logger';
import type { GameTool, ToolResult, AnthropicTool } from './tool.interface';

@Injectable()
export class ToolRegistry {
  private readonly logger = new LegendLogger(ToolRegistry.name);
  private readonly tools = new Map<string, GameTool>();

  register(tool: GameTool): void {
    this.tools.set(tool.name, tool);
    this.logger.log(`Registered tool: ${tool.name}`);
  }

  getToolsForLLM(): AnthropicTool[] {
    return Array.from(this.tools.values()).map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema,
    }));
  }

  async execute(
    name: string,
    gameId: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      this.logger.warn(`Unknown tool requested: ${name}`);
      return { success: false, message: `未知工具: ${name}` };
    }
    try {
      this.logger.log(`Executing tool: ${name}(${JSON.stringify(args)})`);
      return await tool.execute(gameId, args);
    } catch (err) {
      this.logger.error(`Tool ${name} failed:`, (err as Error).message);
      return { success: false, message: `工具执行失败: ${(err as Error).message}` };
    }
  }
}
