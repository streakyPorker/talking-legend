import { Controller, Get, Param } from '@nestjs/common';
import { WorldService } from './world.service';

@Controller('game/:gameId/world')
export class WorldController {
  constructor(private readonly worldService: WorldService) {}

  @Get()
  getState(@Param('gameId') gameId: string) {
    return { success: true, data: { gameId, state: '[world state coming in RFC-008]' } };
  }
}
