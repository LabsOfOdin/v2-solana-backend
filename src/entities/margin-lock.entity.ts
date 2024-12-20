import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';

@Entity('margin_locks')
export class MarginLock {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @ManyToOne(() => User, (user) => user.marginLocks)
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  positionId: string;

  @Column({ type: 'decimal', precision: 40, scale: 20 })
  amount: string;

  @CreateDateColumn()
  createdAt: Date;
}
