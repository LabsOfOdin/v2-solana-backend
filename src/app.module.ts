import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { CacheModule } from '@nestjs/cache-manager';
import { DatabaseModule } from './database/database.module';
import { UserModule } from './users/user.module';
import { AuthModule } from './auth/auth.module';
import { MarketModule } from './market/market.module';
import { PriceModule } from './price/price.module';
import { TradeModule } from './trade/trade.module';
import { MarginModule } from './margin/margin.module';
import { EventsModule } from './events/events.module';
import { LiquidityModule } from './liquidity/liquidity.module';
import { LimitOrderModule } from './limit-order/limit-order.module';
import { LiquidationModule } from './liquidation/liquidation.module';
import { StatsModule } from './stats/stats.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    CacheModule.register({
      isGlobal: true,
    }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    UserModule,
    AuthModule,
    MarketModule,
    PriceModule,
    TradeModule,
    MarginModule,
    EventsModule,
    LiquidityModule,
    LimitOrderModule,
    LiquidationModule,
    StatsModule,
  ],
})
export class AppModule {}
