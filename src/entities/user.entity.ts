import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { Position } from './position.entity';
import { MarginLock } from './margin-lock.entity';
import { LPPosition } from './lp-position.entity';
import { MarginBalance } from '../margin/entities/margin-balance.entity';
import { LimitOrder } from './limit-order.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  publicKey: string;

  @OneToMany(() => Position, (position) => position.user)
  positions: Position[];

  @OneToMany(() => MarginLock, (marginLock) => marginLock.user)
  marginLocks: MarginLock[];

  @OneToMany(() => LPPosition, (lpPosition) => lpPosition.user)
  lpPositions: LPPosition[];

  @OneToMany(() => MarginBalance, (marginBalance) => marginBalance.user)
  marginBalances: MarginBalance[];

  @OneToMany(() => LimitOrder, (limitOrder) => limitOrder.user)
  limitOrders: LimitOrder[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
