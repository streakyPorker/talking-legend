import { Module, forwardRef, Inject } from '@nestjs/common';
import { OnModuleInit } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { PromptModule } from '../prompts/prompt.module';
import { GameModule } from '../game/game.module';
import { WorldModule } from '../world/world.module';
import { GameService } from '../game/game.service';
import { LLMClient } from './client';
import { GMEngine } from './gm-engine';
import { NpcEngine } from './npc-engine';
import { ToolRegistry } from './tool-registry';
import { createMoveToTool } from './tools/move-to.tool';

@Module({
  imports: [ConfigModule, PromptModule, WorldModule, forwardRef(() => GameModule)],
  providers: [
    LLMClient,
    GMEngine,
    NpcEngine,
    ToolRegistry,
    {
      provide: 'MOVE_TO_TOOL',
      useFactory: (gameService: GameService) => createMoveToTool(gameService),
      inject: [GameService],
    },
  ],
  exports: [LLMClient, GMEngine, NpcEngine, ToolRegistry],
})
export class LlmModule implements OnModuleInit {
  constructor(
    private readonly toolRegistry: ToolRegistry,
    @Inject('MOVE_TO_TOOL') private readonly moveToTool: ReturnType<typeof createMoveToTool>,
  ) {}

  onModuleInit() {
    this.toolRegistry.register(this.moveToTool);
  }
}
