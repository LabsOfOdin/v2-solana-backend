import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LiquidityService } from './liquidity.service';
import { LiquidityPool } from '../entities/liquidity-pool.entity';
import { LPPosition } from '../entities/lp-position.entity';
import { MathService } from '../utils/math.service';

@Module({
  imports: [TypeOrmModule.forFeature([LiquidityPool, LPPosition])],
  providers: [LiquidityService, MathService],
  exports: [LiquidityService],
})
export class LiquidityModule {}
