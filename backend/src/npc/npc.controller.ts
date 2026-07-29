import { Controller, Post, Param, Body, Res, HttpException } from '@nestjs/common';
import type { Response } from 'express';
import { NpcService } from './npc.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { talkToNpcSchema } from './npc.schema';

@Controller('game/:gameId/npc')
export class NpcController {
  constructor(private readonly npcService: NpcService) {}

  @Post(':npcId/talk')
  async talk(
    @Param('gameId') gameId: string,
    @Param('npcId') npcId: string,
    @Body(new ZodValidationPipe(talkToNpcSchema)) body: any,
  ) {
    return { success: true, data: { gameId, npcId, message: body.message, response: '[NPC dialogue coming in RFC-006]' } };
  }

  @Post(':npcId/talk/stream')
  async talkStream(
    @Param('gameId') gameId: string,
    @Param('npcId') npcId: string,
    @Body(new ZodValidationPipe(talkToNpcSchema)) body: any,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    try {
      for await (const chunk of this.npcService.talkStream(gameId, npcId, body.message)) {
        res.write(`data: ${chunk}\n\n`);
      }
    } catch (err) {
      const message = err instanceof HttpException ? err.message : 'Internal server error';
      res.write(`data: ${JSON.stringify({ type: 'error', message })}\n\n`);
    } finally {
      if (!res.writableEnded) res.end();
    }
  }
}
