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

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  publicKey: string;

  @Column({ type: 'decimal', precision: 40, scale: 20, default: '0' })
  availableBalance: string;

  @Column({ type: 'decimal', precision: 40, scale: 20, default: '0' })
  totalBalance: string;

  @Column({ type: 'decimal', precision: 40, scale: 20, default: '0' })
  lockedMargin: string;

  @Column({ type: 'decimal', precision: 40, scale: 20, default: '0' })
  unrealizedPnl: string;

  @OneToMany(() => Position, (position) => position.user)
  positions: Position[];

  @OneToMany(() => MarginLock, (marginLock) => marginLock.user)
  marginLocks: MarginLock[];

  @OneToMany(() => LPPosition, (lpPosition) => lpPosition.user)
  lpPositions: LPPosition[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
