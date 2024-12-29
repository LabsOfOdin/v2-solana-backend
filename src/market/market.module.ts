import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MarketService } from './market.service';
import { MarketController } from './market.controller';
import { Market } from '../entities/market.entity';
import { PriceModule } from '../price/price.module';
import { ScheduleModule } from '@nestjs/schedule';
import { TradeModule } from 'src/trade/trade.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Market]),
    PriceModule,
    ScheduleModule.forRoot(),
    forwardRef(() => TradeModule),
  ],
  providers: [MarketService],
  controllers: [MarketController],
  exports: [MarketService],
})
export class MarketModule {}
