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
import { OrderSide, OrderStatus } from '../types/trade.types';
import { TokenType } from '../margin/types/token.types';

@Entity('limit_orders')
export class LimitOrder {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @ManyToOne(() => User, (user) => user.limitOrders)
  @JoinColumn({ name: 'userId', referencedColumnName: 'publicKey' })
  user: User;

  @Column({ type: 'uuid' })
  marketId: string;

  @ManyToOne(() => Market, (market) => market.openLimitOrders)
  @JoinColumn({ name: 'marketId' })
  market: Market;

  @Column({
    type: 'enum',
    enum: OrderSide,
  })
  side: OrderSide;

  @Column({ type: 'decimal', precision: 40, scale: 18 })
  size: string;

  @Column({ type: 'decimal', precision: 40, scale: 18 })
  price: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  leverage: string;

  @Column({
    type: 'enum',
    enum: TokenType,
  })
  token: TokenType;

  @Column({ type: 'varchar', length: 255 })
  symbol: string;

  @Column({ type: 'decimal', precision: 40, scale: 18 })
  requiredMargin: string;

  @Column({
    type: 'enum',
    enum: OrderStatus,
    default: OrderStatus.OPEN,
  })
  status: OrderStatus;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
