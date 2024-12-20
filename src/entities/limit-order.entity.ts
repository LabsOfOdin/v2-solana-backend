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
import { OrderSide, MarginType, OrderStatus } from '../types/trade.types';

@Entity('limit_orders')
export class LimitOrder {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  marketId: string;

  @ManyToOne(() => Market)
  @JoinColumn({ name: 'marketId' })
  market: Market;

  @Column({ type: 'enum', enum: OrderSide })
  side: OrderSide;

  @Column({ type: 'decimal', precision: 40, scale: 20 })
  size: string;

  @Column({ type: 'decimal', precision: 40, scale: 20 })
  price: string;

  @Column({ type: 'decimal', precision: 40, scale: 20 })
  leverage: string;

  @Column({ type: 'enum', enum: MarginType })
  marginType: MarginType;

  @Column({ type: 'enum', enum: OrderStatus, default: OrderStatus.OPEN })
  status: OrderStatus;

  @Column({ type: 'decimal', precision: 40, scale: 20 })
  requiredMargin: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
