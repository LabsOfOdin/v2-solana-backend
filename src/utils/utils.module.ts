import { Module } from '@nestjs/common';
import { MathService } from './math.service';
import { CacheService } from './cache.service';

@Module({
  providers: [MathService, CacheService],
  exports: [MathService, CacheService],
})
export class UtilsModule {}
