import { Module } from '@nestjs/common';
import { StorylineService } from './storyline.service';

@Module({
  providers: [StorylineService],
  exports: [StorylineService],
})
export class StorylineModule {}
