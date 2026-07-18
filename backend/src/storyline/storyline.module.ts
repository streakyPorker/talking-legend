import { Module } from '@nestjs/common';
import { StorylineController } from './storyline.controller';
import { StorylineService } from './storyline.service';

@Module({
  controllers: [StorylineController],
  providers: [StorylineService],
  exports: [StorylineService],
})
export class StorylineModule {}
