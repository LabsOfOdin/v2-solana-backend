import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { User } from './entities/user.entity';
import { Position } from './entities/position.entity';
import { MarginLock } from './entities/margin-lock.entity';
import { LiquidityPool } from './entities/liquidity-pool.entity';
import { LPPosition } from './entities/lp-position.entity';
import { Trade } from './entities/trade.entity';
import { Market } from './entities/market.entity';
import { TradeModule } from './trade/trade.module';
import { UserModule } from './user/user.module';
import { LiquidityModule } from './liquidity/liquidity.module';
import { PriceModule } from './price/price.module';
import { AuthModule } from './auth/auth.module';
import { MarketModule } from './market/market.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
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
        ],
        synchronize: configService.get('NODE_ENV') !== 'production', // Don't use in production!
        ssl: {
          rejectUnauthorized: false, // Required for Supabase
        },
      }),
      inject: [ConfigService],
    }),
    TradeModule,
    UserModule,
    LiquidityModule,
    PriceModule,
    AuthModule,
    MarketModule,
  ],
})
export class AppModule {}
