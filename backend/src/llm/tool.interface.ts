/** RFC-016: 游戏内 Tool call 接口 */

export interface GameTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  execute: (gameId: string, args: Record<string, unknown>) => Promise<ToolResult>;
}

export interface ToolResult {
  success: boolean;
  message: string;
  stateChanges?: Record<string, unknown>;
}

/** Anthropic API tools 参数格式 */
export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}
