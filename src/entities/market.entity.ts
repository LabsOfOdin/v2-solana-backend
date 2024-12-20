import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { Position } from './position.entity';
import { Trade } from './trade.entity';
import { MarketStatus } from '../types/market.types';

@Entity('markets')
export class Market {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  symbol: string;

  @Column()
  baseAsset: string;

  @Column()
  quoteAsset: string;

  @Column({ type: 'decimal', precision: 40, scale: 20 })
  minOrderSize: string;

  @Column({ type: 'decimal', precision: 40, scale: 20 })
  maxLeverage: string;

  @Column({ type: 'decimal', precision: 40, scale: 20 })
  maintainanceMargin: string;

  @Column({ type: 'decimal', precision: 40, scale: 20 })
  takerFee: string;

  @Column({ type: 'decimal', precision: 40, scale: 20 })
  makerFee: string;

  @Column({ type: 'enum', enum: MarketStatus, default: MarketStatus.ACTIVE })
  status: MarketStatus;

  @Column({ type: 'decimal', precision: 40, scale: 20 })
  fundingRate: string;

  @Column()
  pythPriceAccountKey: string;

  @Column({ default: true })
  allowIsolated: boolean;

  @Column({ default: true })
  allowCross: boolean;

  @OneToMany(() => Position, (position) => position.market)
  positions: Position[];

  @OneToMany(() => Trade, (trade) => trade.market)
  trades: Trade[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
