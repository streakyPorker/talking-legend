import { Global, Module } from '@nestjs/common';
import { WorldConfigService } from './world-config.service';

@Global()
@Module({
  providers: [WorldConfigService],
  exports: [WorldConfigService],
})
export class WorldConfigModule {}
