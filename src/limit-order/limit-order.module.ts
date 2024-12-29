import { Module } from '@nestjs/common';
import { LimitOrderService } from './limit-order.service';
import { TradeModule } from '../trade/trade.module';
import { UserModule } from '../user/user.module';
import { PriceModule } from '../price/price.module';
import { MarginModule } from '../margin/margin.module';
import { LimitOrderController } from './limit-order.controller';
import { EventsModule } from 'src/events/events.module';
import { DatabaseModule } from 'src/database/database.module';

@Module({
  imports: [
    DatabaseModule,
    TradeModule,
    UserModule,
    PriceModule,
    MarginModule,
    EventsModule,
  ],
  controllers: [LimitOrderController],
  providers: [LimitOrderService],
  exports: [LimitOrderService],
})
export class LimitOrderModule {}
