import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TradeService } from './trade.service';
import { Position } from '../entities/position.entity';
import { Trade } from '../entities/trade.entity';
import { Market } from '../entities/market.entity';
import { UserModule } from '../user/user.module';
import { LiquidityModule } from '../liquidity/liquidity.module';
import { PriceModule } from '../price/price.module';
import { UtilsModule } from '../utils/utils.module';
import { MarginModule } from 'src/margin/margin.module';
import { TradeController } from './trade.controller';
import { EventsModule } from 'src/events/events.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Position, Trade, Market]),
    UserModule,
    LiquidityModule,
    PriceModule,
    UtilsModule,
    MarginModule,
    EventsModule,
  ],
  providers: [TradeService],
  controllers: [TradeController],
  exports: [TradeService],
})
export class TradeModule {}
