import { Module, forwardRef } from '@nestjs/common';
import { MarketService } from './market.service';
import { MarketController } from './market.controller';
import { ScheduleModule } from '@nestjs/schedule';
import { TradeModule } from 'src/trade/trade.module';
import { DatabaseModule } from 'src/database/database.module';
import { StatsModule } from '../stats/stats.module';
import { PriceModule } from 'src/price/price.module';

@Module({
  imports: [
    DatabaseModule,
    ScheduleModule.forRoot(),
    PriceModule,
    forwardRef(() => TradeModule),
    StatsModule,
  ],
  providers: [MarketService],
  controllers: [MarketController],
  exports: [MarketService],
})
export class MarketModule {}
