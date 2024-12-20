import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LiquidityPool } from '../entities/liquidity-pool.entity';
import { LPPosition } from '../entities/lp-position.entity';
import { OrderRequest } from '../types/trade.types';
import { MathService } from '../utils/math.service';

/**
 * When a user deposits funds into the protocol, we'll need to handle register the deposit.
 * Also when they withdraw funds too.
 */

@Injectable()
export class LiquidityService {
  constructor(
    @InjectRepository(LiquidityPool)
    private readonly liquidityPoolRepository: Repository<LiquidityPool>,
    @InjectRepository(LPPosition)
    private readonly lpPositionRepository: Repository<LPPosition>,
    private readonly mathService: MathService,
  ) {}

  async validateLiquidityForTrade(order: OrderRequest): Promise<void> {
    const pool = await this.getLiquidityPool();
    const requiredLiquidity = this.calculateRequiredLiquidity(order);

    if (
      this.mathService.compare(pool.availableLiquidity, requiredLiquidity) < 0
    ) {
      throw new Error('Insufficient liquidity in pool');
    }

    const newUtilizationRate = this.calculateNewUtilizationRate(
      pool,
      requiredLiquidity,
    );

    if (
      this.mathService.compare(newUtilizationRate, pool.maxUtilizationRate) > 0
    ) {
      throw new Error('Trade would exceed maximum utilization rate');
    }
  }

  async getLiquidityPool(): Promise<LiquidityPool> {
    const pool = await this.liquidityPoolRepository.findOne({
      where: {},
      order: { createdAt: 'DESC' },
    });

    if (!pool) {
      // Initialize pool if it doesn't exist
      return this.liquidityPoolRepository.save(
        this.liquidityPoolRepository.create({
          totalLiquidity: '0',
          availableLiquidity: '0',
          utilizationRate: '0',
          maxUtilizationRate: '0.8',
          lpTokenSupply: '0',
        }),
      );
    }

    return pool;
  }

  async getUserLPPosition(userId: string): Promise<LPPosition> {
    const position = await this.lpPositionRepository.findOne({
      where: { userId },
    });

    if (!position) {
      throw new NotFoundException(`LP position for user ${userId} not found`);
    }

    return position;
  }

  async addLiquidity(
    userId: string,
    amount: string,
  ): Promise<{ lpTokens: string; sharePercentage: string }> {
    const pool = await this.getLiquidityPool();

    // Calculate LP tokens to mint based on current pool state
    const lpTokensToMint = this.calculateLPTokensToMint(amount, pool);
    const newSharePercentage = this.mathService.divide(
      lpTokensToMint,
      this.mathService.add(pool.lpTokenSupply, lpTokensToMint),
    );

    // Update pool state
    await this.liquidityPoolRepository.update(pool.id, {
      totalLiquidity: this.mathService.add(pool.totalLiquidity, amount),
      availableLiquidity: this.mathService.add(pool.availableLiquidity, amount),
      lpTokenSupply: this.mathService.add(pool.lpTokenSupply, lpTokensToMint),
      utilizationRate: this.calculateUtilizationRate(pool, amount, true),
    });

    // Record user's LP position
    const existingPosition = await this.lpPositionRepository.findOne({
      where: { userId },
    });

    if (existingPosition) {
      await this.lpPositionRepository.update(existingPosition.id, {
        lpTokens: this.mathService.add(
          existingPosition.lpTokens,
          lpTokensToMint,
        ),
        sharePercentage: newSharePercentage,
        depositedAmount: this.mathService.add(
          existingPosition.depositedAmount,
          amount,
        ),
      });
    } else {
      await this.lpPositionRepository.save(
        this.lpPositionRepository.create({
          userId,
          lpTokens: lpTokensToMint,
          sharePercentage: newSharePercentage,
          depositedAmount: amount,
        }),
      );
    }

    return {
      lpTokens: lpTokensToMint,
      sharePercentage: newSharePercentage,
    };
  }

  async removeLiquidity(
    userId: string,
    lpTokens: string,
  ): Promise<{ amount: string }> {
    const [pool, lpPosition] = await Promise.all([
      this.getLiquidityPool(),
      this.getUserLPPosition(userId),
    ]);

    if (this.mathService.compare(lpTokens, lpPosition.lpTokens) > 0) {
      throw new Error('Insufficient LP tokens');
    }

    // Calculate withdrawal amount based on current pool state
    const withdrawalAmount = this.calculateWithdrawalAmount(lpTokens, pool);

    if (
      this.mathService.compare(withdrawalAmount, pool.availableLiquidity) > 0
    ) {
      throw new Error('Insufficient available liquidity');
    }

    // Update pool state
    await this.liquidityPoolRepository.update(pool.id, {
      totalLiquidity: this.mathService.subtract(
        pool.totalLiquidity,
        withdrawalAmount,
      ),
      availableLiquidity: this.mathService.subtract(
        pool.availableLiquidity,
        withdrawalAmount,
      ),
      lpTokenSupply: this.mathService.subtract(pool.lpTokenSupply, lpTokens),
      utilizationRate: this.calculateUtilizationRate(
        pool,
        withdrawalAmount,
        false,
      ),
    });

    // Update user's LP position
    const newLpTokens = this.mathService.subtract(
      lpPosition.lpTokens,
      lpTokens,
    );
    const newSharePercentage = this.mathService.divide(
      newLpTokens,
      this.mathService.subtract(pool.lpTokenSupply, lpTokens),
    );

    if (this.mathService.isZero(newLpTokens)) {
      await this.lpPositionRepository.delete(lpPosition.id);
    } else {
      await this.lpPositionRepository.update(lpPosition.id, {
        lpTokens: newLpTokens,
        sharePercentage: newSharePercentage,
        depositedAmount: this.mathService.subtract(
          lpPosition.depositedAmount,
          withdrawalAmount,
        ),
      });
    }

    return { amount: withdrawalAmount };
  }

  private calculateRequiredLiquidity(order: OrderRequest): string {
    return this.mathService.divide(
      this.mathService.multiply(order.size, order.price || '0'),
      order.leverage,
    );
  }

  private calculateNewUtilizationRate(
    pool: LiquidityPool,
    requiredLiquidity: string,
  ): string {
    const usedLiquidity = this.mathService.add(
      this.mathService.subtract(pool.totalLiquidity, pool.availableLiquidity),
      requiredLiquidity,
    );

    return this.mathService.divide(usedLiquidity, pool.totalLiquidity);
  }

  private calculateUtilizationRate(
    pool: LiquidityPool,
    amount: string,
    isDeposit: boolean,
  ): string {
    const newTotalLiquidity = isDeposit
      ? this.mathService.add(pool.totalLiquidity, amount)
      : this.mathService.subtract(pool.totalLiquidity, amount);

    const usedLiquidity = this.mathService.subtract(
      newTotalLiquidity,
      isDeposit
        ? this.mathService.add(pool.availableLiquidity, amount)
        : this.mathService.subtract(pool.availableLiquidity, amount),
    );

    return this.mathService.divide(usedLiquidity, newTotalLiquidity);
  }

  private calculateLPTokensToMint(amount: string, pool: LiquidityPool): string {
    if (this.mathService.isZero(pool.totalLiquidity)) {
      return amount; // Initial liquidity 1:1
    }

    return this.mathService.divide(
      this.mathService.multiply(amount, pool.lpTokenSupply),
      pool.totalLiquidity,
    );
  }

  private calculateWithdrawalAmount(
    lpTokens: string,
    pool: LiquidityPool,
  ): string {
    return this.mathService.divide(
      this.mathService.multiply(lpTokens, pool.totalLiquidity),
      pool.lpTokenSupply,
    );
  }
}
