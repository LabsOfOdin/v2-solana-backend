import { Module, forwardRef } from '@nestjs/common';
import { MarketService } from './market.service';
import { MarketController } from './market.controller';
import { PriceModule } from '../price/price.module';
import { ScheduleModule } from '@nestjs/schedule';
import { TradeModule } from 'src/trade/trade.module';
import { DatabaseModule } from 'src/database/database.module';

@Module({
  imports: [
    DatabaseModule,
    PriceModule,
    ScheduleModule.forRoot(),
    forwardRef(() => TradeModule),
  ],
  providers: [MarketService],
  controllers: [MarketController],
  exports: [MarketService],
})
export class MarketModule {}
