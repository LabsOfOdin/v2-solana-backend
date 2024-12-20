import { Injectable } from '@nestjs/common';
import { OrderRequest } from '../types/trade.types';
import { MathService } from '../utils/math.service';

@Injectable()
export class LiquidityService {
  constructor(
    private readonly mathService: MathService,
    // TODO: Inject Solana program service/connection
  ) {}

  async validateLiquidityForTrade(order: OrderRequest): Promise<void> {
    // TODO: Fetch current liquidity pool state from Solana program
    const poolState = (await this.getSolanaPoolState()) as any;
    const requiredLiquidity = this.calculateRequiredLiquidity(order);

    if (
      this.mathService.compare(
        poolState.availableLiquidity,
        requiredLiquidity,
      ) < 0
    ) {
      throw new Error('Insufficient liquidity in pool');
    }

    if (
      this.mathService.compare(
        poolState.utilizationRate,
        poolState.maxUtilizationRate,
      ) > 0
    ) {
      throw new Error('Trade would exceed maximum utilization rate');
    }
  }

  private calculateRequiredLiquidity(order: OrderRequest): string {
    return this.mathService.divide(
      this.mathService.multiply(order.size, order.price || '0'),
      order.leverage,
    );
  }

  private async getSolanaPoolState() {
    // TODO: Implement fetching pool state from Solana program
    throw new Error('Not implemented: Need to fetch pool state from Solana');
  }
}
