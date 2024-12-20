export interface LiquidityPool {
  id: string;
  totalLiquidity: string;
  availableLiquidity: string;
  utilizationRate: string;
  maxUtilizationRate: string;
  lpTokenSupply: string;
  updatedAt: Date;
}

export interface LPPosition {
  userId: string;
  lpTokens: string;
  sharePercentage: string;
  depositedAmount: string;
  createdAt: Date;
  updatedAt: Date;
}
