import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from './user.entity';
import { Market } from './market.entity';
import { OrderSide } from '../types/trade.types';
import { TokenType } from '../margin/types/token.types';

export enum PositionStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
  LIQUIDATED = 'LIQUIDATED',
}

@Entity('positions')
export class Position {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @ManyToOne(() => User, (user) => user.positions)
  @JoinColumn({ name: 'userId', referencedColumnName: 'publicKey' })
  user: User;

  @Column({ type: 'uuid' })
  marketId: string;

  @Column({ type: 'varchar', length: 20 })
  symbol: string;

  @ManyToOne(() => Market)
  @JoinColumn({ name: 'marketId', referencedColumnName: 'id' })
  market: Market;

  @Column({
    type: 'enum',
    enum: OrderSide,
  })
  side: OrderSide;

  @Column({ type: 'decimal', precision: 40, scale: 18 })
  size: string;

  @Column({ type: 'decimal', precision: 40, scale: 18 })
  entryPrice: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  leverage: string;

  @Column({ type: 'decimal', precision: 40, scale: 18, nullable: true })
  stopLossPrice?: string;

  @Column({ type: 'decimal', precision: 40, scale: 18, nullable: true })
  takeProfitPrice?: string;

  @Column({ type: 'decimal', precision: 40, scale: 18, nullable: true })
  trailingStopDistance?: string;

  @Column({ type: 'decimal', precision: 40, scale: 18 })
  margin: string;

  @Column({
    type: 'enum',
    enum: TokenType,
  })
  token: TokenType;

  @Column({ type: 'decimal', precision: 40, scale: 18, default: '0' })
  lockedMarginSOL: string;

  @Column({ type: 'decimal', precision: 40, scale: 18, default: '0' })
  lockedMarginUSDC: string;

  @Column({ type: 'decimal', precision: 40, scale: 18, nullable: true })
  realizedPnl?: string;

  @Column({
    type: 'enum',
    enum: PositionStatus,
    default: PositionStatus.OPEN,
  })
  status: PositionStatus;

  @Column({ type: 'decimal', precision: 40, scale: 18, nullable: true })
  closingPrice?: string;

  @Column({ nullable: true })
  closedAt?: Date;

  @Column({ type: 'decimal', precision: 40, scale: 18, default: '0' })
  accumulatedFunding: string;

  @Column({ type: 'decimal', precision: 40, scale: 18, default: '0' })
  accumulatedBorrowingFee: string;

  @Column({ type: 'timestamp', nullable: true })
  lastBorrowingFeeUpdate: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
