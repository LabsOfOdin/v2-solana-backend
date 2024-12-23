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

  @Column({ type: 'decimal', precision: 40, scale: 20 })
  maxLeverage: string;

  @Column({ type: 'decimal', precision: 40, scale: 20 })
  maintainanceMargin: string;

  @Column({ type: 'decimal', precision: 40, scale: 20 })
  takerFee: string;

  @Column({ type: 'decimal', precision: 40, scale: 20 })
  makerFee: string;

  @Column({ type: 'decimal', precision: 40, scale: 20 })
  fundingRate: string;

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
