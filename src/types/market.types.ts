export enum MarketStatus {
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  CLOSED = 'CLOSED',
}

export interface CreateMarketDto {
  symbol: string;
  tokenAddress: string;
  maxLeverage: string;
  maintainanceMargin: string;
  takerFee: string;
  makerFee: string;
}

export interface UpdateMarketDto {
  maxLeverage?: string;
  maintainanceMargin?: string;
  takerFee?: string;
  makerFee?: string;
  status?: MarketStatus;
  fundingRate?: string;
}

export interface MarketInfo {
  id: string;
  symbol: string;
  tokenAddress: string;
  maxLeverage: string;
  maintainanceMargin: string;
  takerFee: string;
  makerFee: string;
  status: MarketStatus;
  fundingRate: string;
  lastPrice?: string;
  volume24h?: string;
  openInterest?: string;
}

export interface MarketStats {
  price: string;
  priceChange24h: string;
  volume24h: string;
  openInterest: string;
  fundingRate: string;
  nextFundingTime: Date;
  markPrice: string;
  indexPrice: string;
  maxLeverage: string;
  liquidationFee: string;
  tradingFee: string;
  borrowingRate: string;
}
