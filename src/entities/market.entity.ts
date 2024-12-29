import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { Position } from './position.entity';
import { LimitOrder } from './limit-order.entity';
import { MarketStatus } from '../types/market.types';

@Entity('markets')
export class Market {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  symbol: string;

  @Column()
  tokenAddress: string;

  @Column()
  poolAddress: string;

  @Column({ type: 'decimal', precision: 40, scale: 20 })
  maxLeverage: string;

  @Column({ type: 'decimal', precision: 40, scale: 20 })
  maintainanceMargin: string;

  @Column({ type: 'decimal', precision: 40, scale: 20, default: 0.0003 })
  borrowingRate: string;

  @Column({ type: 'decimal', precision: 40, scale: 20, default: 0 })
  fundingRate: string;

  @Column({ type: 'decimal', precision: 40, scale: 20, default: 0 })
  fundingRateVelocity: string;

  @Column({ type: 'bigint', default: 0 })
  lastUpdatedTimestamp: number;

  @Column({ type: 'decimal', precision: 40, scale: 20, default: 0 })
  longOpenInterest: string;

  @Column({ type: 'decimal', precision: 40, scale: 20, default: 0 })
  shortOpenInterest: string;

  @Column({ type: 'decimal', precision: 40, scale: 20, default: 0 })
  impactPool: string;

  @Column({ type: 'decimal', precision: 40, scale: 20, default: 0 })
  cumulativeFees: string;

  @Column({ type: 'decimal', precision: 40, scale: 20, default: 0 })
  unclaimedFees: string;

  @Column({ type: 'decimal', precision: 40, scale: 20, default: 0.0003 }) // Default to 0.03%
  maxFundingRate: string;

  @Column({ type: 'decimal', precision: 40, scale: 20, default: 0.00015 })
  maxFundingVelocity: string;

  @Column({ type: 'enum', enum: MarketStatus, default: MarketStatus.ACTIVE })
  status: MarketStatus;

  @OneToMany(() => Position, (position) => position.market)
  positions: Position[];

  @OneToMany(() => LimitOrder, (order) => order.market)
  openLimitOrders: LimitOrder[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
