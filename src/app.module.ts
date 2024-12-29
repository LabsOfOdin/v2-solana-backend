import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CacheModule } from '@nestjs/cache-manager';
import { TradeModule } from './trade/trade.module';
import { UserModule } from './user/user.module';
import { LiquidityModule } from './liquidity/liquidity.module';
import { PriceModule } from './price/price.module';
import { AuthModule } from './auth/auth.module';
import { MarketModule } from './market/market.module';
import { LimitOrderModule } from './limit-order/limit-order.module';
import { LiquidationModule } from './liquidation/liquidation.module';
import { UtilsModule } from './utils/utils.module';
import { DatabaseModule } from './database/database.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    CacheModule.register({
      isGlobal: true,
    }),
    DatabaseModule,
    TradeModule,
    UserModule,
    LiquidityModule,
    PriceModule,
    AuthModule,
    MarketModule,
    LimitOrderModule,
    LiquidationModule,
    UtilsModule,
  ],
})
export class AppModule {}
