export interface LiquidityPool {
  id: string;
  totalLiquidity: string;
  availableLiquidity: string;
  utilizationRate: string;
  maxUtilizationRate: string;
  lpTokenSupply: string;
  createdAt: Date;
  updatedAt: Date;
}
