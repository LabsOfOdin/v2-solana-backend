import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LiquidationService } from './liquidation.service';
import { Position } from '../entities/position.entity';
import { TradeModule } from '../trade/trade.module';
import { UserModule } from '../user/user.module';
import { PriceModule } from '../price/price.module';
import { MathService } from '../utils/math.service';
import { MarginModule } from 'src/margin/margin.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Position]),
    TradeModule,
    UserModule,
    PriceModule,
    MarginModule,
  ],
  providers: [LiquidationService, MathService],
  exports: [LiquidationService],
})
export class LiquidationModule {}
