import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LimitOrderService } from './limit-order.service';
import { LimitOrder } from '../entities/limit-order.entity';
import { TradeModule } from '../trade/trade.module';
import { UserModule } from '../user/user.module';
import { PriceModule } from '../price/price.module';
import { MathService } from '../utils/math.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([LimitOrder]),
    TradeModule,
    UserModule,
    PriceModule,
  ],
  providers: [LimitOrderService, MathService],
  exports: [LimitOrderService],
})
export class LimitOrderModule {}
