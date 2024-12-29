import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LiquidationService } from './liquidation.service';
import { Position } from '../entities/position.entity';
import { Market } from '../entities/market.entity';
import { UserModule } from '../user/user.module';
import { PriceModule } from '../price/price.module';
import { EventsModule } from '../events/events.module';
import { MarginModule } from '../margin/margin.module';
import { MarketModule } from '../market/market.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Position, Market]),
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
