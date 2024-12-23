import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { config } from 'dotenv';
import { User } from './src/entities/user.entity';
import { Position } from './src/entities/position.entity';
import { MarginLock } from './src/entities/margin-lock.entity';
import { LiquidityPool } from './src/entities/liquidity-pool.entity';
import { LPPosition } from './src/entities/lp-position.entity';
import { Trade } from './src/entities/trade.entity';
import { Market } from './src/entities/market.entity';
import { LimitOrder } from './src/entities/limit-order.entity';
import { MarginBalance } from './src/margin/entities/margin-balance.entity';

config();

const configService = new ConfigService();

export default new DataSource({
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
  migrations: ['src/migrations/*.ts'],
  ssl: {
    rejectUnauthorized: false,
  },
});
