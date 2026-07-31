import { Module, forwardRef } from '@nestjs/common';
import { NpcController } from './npc.controller';
import { NpcService } from './npc.service';
import { LlmModule } from '../llm/llm.module';
import { GameModule } from '../game/game.module';

@Module({
  imports: [forwardRef(() => LlmModule), forwardRef(() => GameModule)],
  controllers: [NpcController],
  providers: [NpcService],
  exports: [NpcService],
})
export class NpcModule {}
