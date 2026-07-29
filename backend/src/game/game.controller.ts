import {
  Controller,
  Post,
  Body,
  Param,
  Res,
  HttpCode,
  HttpStatus,
  HttpException,
} from '@nestjs/common';
import type { Response } from 'express';
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
}
