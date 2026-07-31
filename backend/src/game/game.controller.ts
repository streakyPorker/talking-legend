import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Res,
  HttpCode,
  HttpStatus,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import type { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import type {
  APIResponse,
  CreateGameResponse,
  GameActionResponse,
} from '@talking-legend/shared';
import { GameService } from './game.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  CreateGameRequestSchema,
  GameActionRequestSchema,
  CreateGameRequestValidated,
  GameActionRequestValidated,
} from './game.schema';

@Controller('game')
export class GameController {
  constructor(private readonly gameService: GameService) {}

  @Get(':id')
  async getState(@Param('id') id: string): Promise<APIResponse<any>> {
    return { success: true, data: this.gameService.getFullState(id) };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(new ZodValidationPipe(CreateGameRequestSchema)) body: CreateGameRequestValidated,
  ): Promise<APIResponse<CreateGameResponse>> {
    const result = await this.gameService.createGame(body);
    return { success: true, data: result };
  }

  @Post(':id/action')
  async performAction(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(GameActionRequestSchema)) body: GameActionRequestValidated,
  ): Promise<APIResponse<GameActionResponse>> {
    const result = await this.gameService.performAction(id, { gameId: id, ...body });
    return { success: true, data: result };
  }

  @Post(':id/move')
  async move(
    @Param('id') id: string,
    @Body() body: { targetRegion: string },
  ) {
    const result = await this.gameService.moveToRegion(id, body.targetRegion, 'click');
    return { success: true, data: result };
  }

  @Post(':id/action/stream')
  async performActionStream(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(GameActionRequestSchema)) body: GameActionRequestValidated,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    try {
      for await (const chunk of this.gameService.performActionStream(id, body.action, body.target)) {
        res.write(`data: ${chunk}\n\n`);
      }
    } catch (err) {
      const message = err instanceof HttpException ? err.message : 'Internal server error';
      res.write(`data: ${JSON.stringify({ type: 'error', message })}\n\n`);
    } finally {
      if (!res.writableEnded) res.end();
    }
  }

  // ── Save / Load ───────────────────────────────────────────────

  @Get(':id/saves')
  async listSaves(@Param('id') _id: string) {
    return { success: true, data: this.gameService.listSaves() };
  }

  @Post(':id/save')
  async save(@Param('id') id: string, @Body() body: { slot: number }) {
    const result = await this.gameService.saveGame(id, body.slot);
    return { success: true, data: result };
  }

  @Post('saves/:slot/load')
  async load(@Param('slot') slot: string) {
    const saveSlot = parseInt(slot, 10);
    // Verify save exists
    this.gameService.loadSave(saveSlot);

    // Copy save file over main DB
    const savePath = path.join(process.cwd(), 'data', 'saves', `slot_${saveSlot}.db`);
    const dbPath = path.join(process.cwd(), 'data', 'talking-legend.db');
    if (!fs.existsSync(savePath)) throw new NotFoundException('Save not found');
    fs.copyFileSync(savePath, dbPath);
    return { success: true, data: { message: '存档已加载，即将跳转' } };
  }

  @Delete('saves/:slot')
  async deleteSave(@Param('slot') slot: string) {
    await this.gameService.deleteSave(parseInt(slot, 10));
    return { success: true, data: { message: '已删除' } };
  }
}
