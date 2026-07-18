import {
  Controller,
  Post,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  UsePipes,
} from '@nestjs/common';
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
}
