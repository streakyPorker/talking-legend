import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import type { APIResponse } from '@talking-legend/shared';

@Controller('playtest')
export class PlaytestController {
  private readonly baseDir = path.resolve(process.cwd(), '..', 'playtest');

  @Post('record')
  @HttpCode(HttpStatus.CREATED)
  async record(@Body() body: {
    worldId: string;
    playerName: string;
    action: string;
    narrative: string;
    turn: number;
    tokenEstimate?: number;
  }): Promise<APIResponse<{ saved: string }>> {
    const worldDir = path.join(this.baseDir, body.worldId);
    fs.mkdirSync(worldDir, { recursive: true });

    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(worldDir, `turn-${body.turn}-${ts}.json`);
    fs.writeFileSync(file, JSON.stringify({
      playerName: body.playerName,
      action: body.action,
      narrative: body.narrative,
      turn: body.turn,
      tokenEstimate: body.tokenEstimate ?? 0,
      recordedAt: new Date().toISOString(),
    }, null, 2), 'utf-8');

    return { success: true, data: { saved: file } };
  }
}
