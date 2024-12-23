import { Injectable } from '@nestjs/common';
import { OrderRequest } from '../types/trade.types';
import { MathService } from '../utils/math.service';
import { PriceService } from '../price/price.service';

@Injectable()
export class LiquidityService {
  // Mock pool state with plenty of liquidity
  private mockPoolState = {
    availableLiquidity: '10000000', // 10M USDC
    totalLiquidity: '10000000',
    utilizationRate: '0',
    maxUtilizationRate: '0.8',
  };

  constructor(
    private readonly mathService: MathService,
    private readonly priceService: PriceService,
  ) {}

  async validateLiquidityForTrade(order: OrderRequest): Promise<void> {
    const requiredLiquidity = await this.calculateRequiredLiquidity(order);

    if (
      this.mathService.compare(
        this.mockPoolState.availableLiquidity,
        requiredLiquidity,
      ) < 0
    ) {
      throw new Error('Insufficient liquidity in pool');
    }

    const utilizationRate = this.mathService.divide(
      requiredLiquidity,
      this.mockPoolState.totalLiquidity,
    );

    if (
      this.mathService.compare(
        utilizationRate,
        this.mockPoolState.maxUtilizationRate,
      ) > 0
    ) {
      throw new Error('Trade would exceed maximum utilization rate');
    }
  }

  async getAvailableLiquidity(): Promise<{
    availableLiquidity: string;
    totalLiquidity: string;
    utilizationRate: string;
    maxUtilizationRate: string;
  }> {
    return this.mockPoolState;
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
}
