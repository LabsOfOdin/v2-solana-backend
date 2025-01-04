import { Position } from './position.entity';
import { LimitOrder } from './limit-order.entity';
import { MarketStatus } from '../types/market.types';

export interface Market {
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
  virtualBaseReserve: string;
  virtualQuoteReserve: string;
  virtualK: string;
  cumulativeFeesSol: string;
  cumulativeFeesUsdc: string;
  unclaimedFeesSol: string;
  unclaimedFeesUsdc: string;
  maxFundingRate: string;
  maxFundingVelocity: string;
  status: MarketStatus;
  positions: Position[];
  openLimitOrders: LimitOrder[];
  availableLiquidity: string;
  createdAt: Date;
  updatedAt: Date;
}
