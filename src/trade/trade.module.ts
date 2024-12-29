import { Module, forwardRef } from '@nestjs/common';
import { TradeService } from './trade.service';
import { UserModule } from '../user/user.module';
import { LiquidityModule } from '../liquidity/liquidity.module';
import { PriceModule } from '../price/price.module';
import { UtilsModule } from '../utils/utils.module';
import { MarginModule } from 'src/margin/margin.module';
import { TradeController } from './trade.controller';
import { EventsModule } from 'src/events/events.module';
import { MarketModule } from 'src/market/market.module';
import { DatabaseModule } from 'src/database/database.module';

@Module({
  imports: [
    DatabaseModule,
    UserModule,
    LiquidityModule,
    PriceModule,
    UtilsModule,
    MarginModule,
    EventsModule,
    forwardRef(() => MarketModule),
  ],
  providers: [TradeService],
  controllers: [TradeController],
  exports: [TradeService],
})
export class TradeModule {}
