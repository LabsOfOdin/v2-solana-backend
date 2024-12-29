import { Module } from '@nestjs/common';
import { LiquidityService } from './liquidity.service';
import { LiquidityController } from './liquidity.controller';
import { PriceModule } from '../price/price.module';
import { DatabaseModule } from 'src/database/database.module';

@Module({
  imports: [DatabaseModule, PriceModule],
  providers: [LiquidityService],
  controllers: [LiquidityController],
  exports: [LiquidityService],
})
export class LiquidityModule {}
