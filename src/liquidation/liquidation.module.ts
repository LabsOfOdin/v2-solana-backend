import { Module } from '@nestjs/common';
import { LiquidationService } from './liquidation.service';
import { UserModule } from '../users/user.module';
import { PriceModule } from '../price/price.module';
import { EventsModule } from '../events/events.module';
import { MarginModule } from '../margin/margin.module';
import { MarketModule } from '../market/market.module';
import { DatabaseModule } from 'src/database/database.module';

@Module({
  imports: [
    DatabaseModule,
    UserModule,
    PriceModule,
    EventsModule,
    MarginModule,
    MarketModule,
  ],
  providers: [LiquidationService],
  exports: [LiquidationService],
})
export class LiquidationModule {}
