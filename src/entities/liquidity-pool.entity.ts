import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('liquidity_pools')
export class LiquidityPool {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'decimal', precision: 40, scale: 20, default: '0' })
  totalLiquidity: string;

  @Column({ type: 'decimal', precision: 40, scale: 20, default: '0' })
  availableLiquidity: string;

  @Column({ type: 'decimal', precision: 40, scale: 20, default: '0' })
  utilizationRate: string;

  @Column({ type: 'decimal', precision: 40, scale: 20, default: '0.8' })
  maxUtilizationRate: string;

  @Column({ type: 'decimal', precision: 40, scale: 20, default: '0' })
  lpTokenSupply: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
