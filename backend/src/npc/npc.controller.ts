import { Controller, Post, Param, Body } from '@nestjs/common';
import { NpcService } from './npc.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { talkToNpcSchema } from './npc.schema';

@Controller('game/:gameId/npc')
export class NpcController {
  constructor(private readonly npcService: NpcService) {}

  @Post(':npcId/talk')
  talk(@Param('gameId') gameId: string, @Param('npcId') npcId: string, @Body(new ZodValidationPipe(talkToNpcSchema)) body: any) {
    return { success: true, data: { gameId, npcId, message: body.message, response: '[NPC dialogue coming in RFC-006]' } };
  }
}
