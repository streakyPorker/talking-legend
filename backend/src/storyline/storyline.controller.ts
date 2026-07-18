import { Controller, Get, Param } from '@nestjs/common';
import { StorylineService } from './storyline.service';

@Controller('game/:gameId/storyline')
export class StorylineController {
  constructor(private readonly storylineService: StorylineService) {}

  @Get()
  getState(@Param('gameId') gameId: string) {
    return { success: true, data: { gameId, stage: '[storyline state coming in RFC-009]' } };
  }
}
