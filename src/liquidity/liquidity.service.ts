import { Injectable } from '@nestjs/common';
import { OrderRequest } from '../types/trade.types';
import { MathService } from '../utils/math.service';
import { PriceService } from '../price/price.service';

@Injectable()
export class LiquidityService {
  constructor(
    private readonly mathService: MathService,
    private readonly priceService: PriceService,
    // TODO: Inject Solana program service/connection
  ) {}

  async validateLiquidityForTrade(order: OrderRequest): Promise<void> {
    // TODO: Fetch current liquidity pool state from Solana program
    const poolState = (await this.getSolanaPoolState()) as any;
    const requiredLiquidity = await this.calculateRequiredLiquidity(order);

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

  private async calculateRequiredLiquidity(
    order: OrderRequest,
  ): Promise<string> {
    const currentPrice = await this.priceService.getCurrentPrice(
      order.marketId,
    );
    return this.mathService.divide(
      this.mathService.multiply(order.size, currentPrice),
      order.leverage,
    );
  }

  private async getSolanaPoolState() {
    // TODO: Implement fetching pool state from Solana program
    throw new Error('Not implemented: Need to fetch pool state from Solana');
  }
}
