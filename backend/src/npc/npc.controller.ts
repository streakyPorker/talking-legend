import { Controller, Post, Get, Param, Body, Res, HttpException } from '@nestjs/common';
import type { Response } from 'express';
import { NpcService } from './npc.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { talkToNpcSchema } from './npc.schema';

@Controller('game/:gameId/npc')
export class NpcController {
  constructor(private readonly npcService: NpcService) {}

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

  @Get(':npcId/memories')
  async getMemories(@Param('gameId') gameId: string, @Param('npcId') npcId: string) {
    const memories = this.npcService.getMemories(npcId);
    return { success: true, data: memories };
  }

  @Post(':npcId/summary')
  async submitSummary(
    @Param('gameId') gameId: string,
    @Param('npcId') npcId: string,
    @Body() body: { dialogue: Array<{ role: string; content: string }>; playerName: string },
  ) {
    // Fire-and-forget: use haiku to summarize, write to narrative_history + game_events
    this.npcService.generateSummary(gameId, npcId, body).catch(() => {});
    return { success: true };
  }
}
