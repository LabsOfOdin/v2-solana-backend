import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TokenType } from '../types/token.types';

@Entity('margin_locks')
export class MarginLock {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

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

  @UpdateDateColumn()
  updatedAt: Date;
}
