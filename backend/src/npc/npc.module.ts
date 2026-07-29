import { Module, forwardRef } from '@nestjs/common';
import { NpcController } from './npc.controller';
import { NpcService } from './npc.service';
import { LlmModule } from '../llm/llm.module';

@Module({
  imports: [forwardRef(() => LlmModule)],
  controllers: [NpcController],
  providers: [NpcService],
  exports: [NpcService],
})
export class NpcModule {}
