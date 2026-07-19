import { Module } from '@nestjs/common';
import { GameController } from './game.controller';
import { HealthController } from './health.controller';
import { GameService } from './game.service';

@Module({
  controllers: [GameController, HealthController],
  providers: [GameService],
  exports: [GameService],
})
export class GameModule {}
