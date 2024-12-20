import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../../entities/user.entity';
import { TokenType } from '../types/token.types';

@Entity('margin_balances')
export class MarginBalance {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, (user) => user.marginBalances)
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({
    type: 'enum',
    enum: TokenType,
  })
  token: TokenType;

  @Column({ type: 'decimal', precision: 40, scale: 18 })
  availableBalance: string;

  @Column({ type: 'decimal', precision: 40, scale: 18 })
  lockedBalance: string;

  @Column({ type: 'decimal', precision: 40, scale: 18 })
  unrealizedPnl: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
