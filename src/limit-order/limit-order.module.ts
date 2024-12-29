import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LimitOrderService } from './limit-order.service';
import { LimitOrder } from '../entities/limit-order.entity';
import { TradeModule } from '../trade/trade.module';
import { UserModule } from '../user/user.module';
import { PriceModule } from '../price/price.module';
import { MarginModule } from '../margin/margin.module';
import { Market } from '../entities/market.entity';
import { LimitOrderController } from './limit-order.controller';
import { EventsModule } from 'src/events/events.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([LimitOrder, Market]),
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
