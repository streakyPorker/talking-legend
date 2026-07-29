import { Module, forwardRef } from '@nestjs/common';
import { GameController } from './game.controller';
import { PlaytestController } from './playtest.controller';
import { HealthController } from './health.controller';
import { GameService } from './game.service';
import { LlmModule } from '../llm/llm.module';
import { PromptModule } from '../prompts/prompt.module';
import { WorldModule } from '../world/world.module';
import { NarrativeService } from './narrative.service';
import { ContextProvider } from './context-provider';

@Module({
  imports: [forwardRef(() => LlmModule), PromptModule, WorldModule],
  controllers: [GameController, PlaytestController, HealthController],
  providers: [GameService, NarrativeService, ContextProvider],
  exports: [GameService, NarrativeService, ContextProvider],
})
export class GameModule {}
