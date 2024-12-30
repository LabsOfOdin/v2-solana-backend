export enum MarketStatus {
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  CLOSED = 'CLOSED',
}

export interface CreateMarketDto {
  symbol: string;
  tokenAddress: string;
  poolAddress: string;
  maxLeverage: string;
  maintainanceMargin: string;
  borrowingRate?: string;
  longOpenInterest?: string;
  shortOpenInterest?: string;
  maxFundingRate?: string;
  maxFundingVelocity?: string;
  availableLiquidity?: string;
}

export interface UpdateMarketDto {
  maxLeverage?: string;
  maintainanceMargin?: string;
  status?: MarketStatus;
  fundingRate?: string;
  borrowingRate?: string;
  longOpenInterest?: string;
  shortOpenInterest?: string;
  poolAddress?: string;
  maxFundingRate?: string;
  maxFundingVelocity?: string;
  impactPool?: string;
  availableLiquidity?: string;
}

export interface MarketInfo {
  id: string;
  symbol: string;
  tokenAddress: string;
  poolAddress: string;
  maxLeverage: string;
  maintainanceMargin: string;
  borrowingRate: string;
  fundingRate: string;
  fundingRateVelocity: string;
  lastUpdatedTimestamp: number;
  longOpenInterest: string;
  shortOpenInterest: string;
  availableLiquidity: string;
  volume24h: string;
  lastPrice: string;
}
