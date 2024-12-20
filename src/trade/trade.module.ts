import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TradeService } from './trade.service';
import { Position } from '../entities/position.entity';
import { Trade } from '../entities/trade.entity';
import { UserModule } from '../user/user.module';
import { LiquidityModule } from '../liquidity/liquidity.module';
import { PriceModule } from '../price/price.module';
import { MathService } from '../utils/math.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Position, Trade]),
    UserModule,
    LiquidityModule,
    PriceModule,
  ],
  providers: [TradeService, MathService],
  exports: [TradeService],
})
export class TradeModule {}
