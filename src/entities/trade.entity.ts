import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';
import { Position } from './position.entity';
import { Market } from './market.entity';
import { OrderSide } from '../types/trade.types';

@Entity('trades')
export class Trade {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  positionId: string;

  @ManyToOne(() => Position)
  @JoinColumn({ name: 'positionId' })
  position: Position;

  @Column()
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId', referencedColumnName: 'publicKey' })
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

  @Column({ type: 'decimal', precision: 40, scale: 20, nullable: true })
  realizedPnl?: string;

  @Column({ type: 'decimal', precision: 40, scale: 20 })
  fee: string;

  @CreateDateColumn()
  createdAt: Date;
}
