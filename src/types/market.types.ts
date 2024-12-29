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
}

export interface MarketInfo {
  id: string;
  symbol: string;
  tokenAddress: string;
  poolAddress: string;
  maxLeverage: string;
  maintainanceMargin: string;
  status: MarketStatus;
  fundingRate: string;
  lastPrice?: string;
  volume24h?: string;
  openInterest?: string;
  borrowingRate?: string;
  longOpenInterest?: string;
  shortOpenInterest?: string;
}

export interface MarketStats {
  markPrice: string;
  priceChange24h: string;
  volume24h: string;
  openInterest: string;
  fundingRate: string;
  maxLeverage: string;
  liquidationFee: string;
  borrowingRate: string;
  longOpenInterest: string;
  shortOpenInterest: string;
}
