import { Module, forwardRef } from '@nestjs/common';
import { TradeService } from './trade.service';
import { UserModule } from '../users/user.module';
import { PriceModule } from '../price/price.module';
import { UtilsModule } from '../utils/utils.module';
import { MarginModule } from 'src/margin/margin.module';
import { TradeController } from './trade.controller';
import { EventsModule } from 'src/events/events.module';
import { MarketModule } from 'src/market/market.module';
import { DatabaseModule } from 'src/database/database.module';
import { StatsModule } from 'src/stats/stats.module';

@Module({
  imports: [
    DatabaseModule,
    UserModule,
    PriceModule,
    UtilsModule,
    MarginModule,
    EventsModule,
    forwardRef(() => MarketModule),
    StatsModule,
  ],
  controllers: [TradeController],
  providers: [TradeService],
  exports: [TradeService],
})
export class TradeModule {}
