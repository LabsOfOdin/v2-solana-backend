export enum MarketStatus {
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  CLOSED = 'CLOSED',
}

export interface CreateMarketDto {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  minOrderSize: string;
  maxLeverage: string;
  maintainanceMargin: string;
  takerFee: string;
  makerFee: string;
  pythPriceAccountKey: string;
  allowIsolated?: boolean;
  allowCross?: boolean;
}

export interface UpdateMarketDto {
  minOrderSize?: string;
  maxLeverage?: string;
  maintainanceMargin?: string;
  takerFee?: string;
  makerFee?: string;
  status?: MarketStatus;
  fundingRate?: string;
  pythPriceAccountKey?: string;
  allowIsolated?: boolean;
  allowCross?: boolean;
}

export interface MarketInfo {
  id: string;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  minOrderSize: string;
  maxLeverage: string;
  maintainanceMargin: string;
  takerFee: string;
  makerFee: string;
  status: MarketStatus;
  fundingRate: string;
  allowIsolated: boolean;
  allowCross: boolean;
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
