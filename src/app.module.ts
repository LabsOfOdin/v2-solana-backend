import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CacheModule } from '@nestjs/cache-manager';
import { User } from './entities/user.entity';
import { Position } from './entities/position.entity';
import { MarginLock } from './entities/margin-lock.entity';
import { LiquidityPool } from './entities/liquidity-pool.entity';
import { LPPosition } from './entities/lp-position.entity';
import { Trade } from './entities/trade.entity';
import { Market } from './entities/market.entity';
import { LimitOrder } from './entities/limit-order.entity';
import { MarginBalance } from './margin/entities/margin-balance.entity';
import { TradeModule } from './trade/trade.module';
import { UserModule } from './user/user.module';
import { LiquidityModule } from './liquidity/liquidity.module';
import { PriceModule } from './price/price.module';
import { AuthModule } from './auth/auth.module';
import { MarketModule } from './market/market.module';
import { LimitOrderModule } from './limit-order/limit-order.module';
import { LiquidationModule } from './liquidation/liquidation.module';
import { UtilsModule } from './utils/utils.module';
import { MarginModule } from './margin/margin.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    CacheModule.registerAsync({
      isGlobal: true,
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        ttl: 60 * 60 * 1000, // 1 hour default TTL
      }),
      inject: [ConfigService],
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get('DB_HOST'),
        port: configService.get('DB_PORT'),
        username: configService.get('DB_USERNAME'),
        password: configService.get('DB_PASSWORD'),
        database: configService.get('DB_NAME'),
        entities: [
          User,
          Position,
          MarginLock,
          LiquidityPool,
          LPPosition,
          Trade,
          Market,
          LimitOrder,
          MarginBalance,
        ],
        synchronize: configService.get('NODE_ENV') !== 'production',
        ssl: {
          rejectUnauthorized: false,
        },
      }),
      inject: [ConfigService],
    }),
    UtilsModule,
    TradeModule,
    UserModule,
    LiquidityModule,
    PriceModule,
    AuthModule,
    MarketModule,
    LimitOrderModule,
    LiquidationModule,
    MarginModule,
  ],
})
export class AppModule {}
