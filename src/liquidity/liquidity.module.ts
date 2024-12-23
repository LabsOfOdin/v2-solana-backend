import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LiquidityService } from './liquidity.service';
import { LiquidityController } from './liquidity.controller';
import { LiquidityPool } from '../entities/liquidity-pool.entity';
import { LPPosition } from '../entities/lp-position.entity';
import { MathService } from '../utils/math.service';
import { PriceModule } from '../price/price.module';

@Module({
  imports: [TypeOrmModule.forFeature([LiquidityPool, LPPosition]), PriceModule],
  providers: [LiquidityService, MathService],
  controllers: [LiquidityController],
  exports: [LiquidityService],
})
export class LiquidityModule {}
