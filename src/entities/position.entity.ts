import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';
import { Market } from './market.entity';
import { OrderSide, MarginType } from '../types/trade.types';

@Entity('positions')
export class Position {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @ManyToOne(() => User, (user) => user.positions)
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  marketId: string;

  @ManyToOne(() => Market, (market) => market.positions)
  @JoinColumn({ name: 'marketId' })
  market: Market;

  @Column({ type: 'enum', enum: OrderSide })
  side: OrderSide;

  @Column({ type: 'decimal', precision: 40, scale: 20 })
  size: string;

  @Column({ type: 'decimal', precision: 40, scale: 20 })
  entryPrice: string;

  @Column({ type: 'decimal', precision: 40, scale: 20 })
  leverage: string;

  @Column({ type: 'enum', enum: MarginType })
  marginType: MarginType;

  @Column({ type: 'decimal', precision: 40, scale: 20 })
  liquidationPrice: string;

  @Column({ type: 'decimal', precision: 40, scale: 20 })
  unrealizedPnl: string;

  @Column({ type: 'decimal', precision: 40, scale: 20 })
  margin: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
