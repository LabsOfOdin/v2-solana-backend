import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { User } from './user.entity';
import { TokenType } from '../margin/types/token.types';

@Entity('margin_locks')
export class MarginLock {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @ManyToOne(() => User, (user) => user.marginLocks)
  @JoinColumn({ name: 'userId', referencedColumnName: 'publicKey' })
  user: User;

  @Column({ type: 'uuid' })
  tradeId: string;

  @Column({
    type: 'enum',
    enum: TokenType,
  })
  token: TokenType;

  @Column({ type: 'decimal', precision: 40, scale: 18 })
  amount: string;

  @CreateDateColumn()
  createdAt: Date;
}
