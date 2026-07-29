import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { PromptModule } from '../prompts/prompt.module';
import { GameModule } from '../game/game.module';
import { LLMClient } from './client';
import { GMEngine } from './gm-engine';
import { NpcEngine } from './npc-engine';

@Module({
  imports: [ConfigModule, PromptModule, forwardRef(() => GameModule)],
  providers: [LLMClient, GMEngine, NpcEngine],
  exports: [LLMClient, GMEngine, NpcEngine],
})
export class LlmModule {}
