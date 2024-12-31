import { OrderSide } from '../types/trade.types';
import { TokenType } from 'src/types/token.types';

export enum PositionStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
  LIQUIDATED = 'LIQUIDATED',
}

export interface Position {
  id: string;
  userId: string;
  marketId: string;
  symbol: string;
  side: OrderSide;
  size: string;
  entryPrice: string;
  leverage: string;
  stopLossPrice?: string;
  takeProfitPrice?: string;
  trailingStopDistance?: string;
  margin: string;
  token: TokenType;
  lockedMarginSOL: string;
  lockedMarginUSDC: string;
  realizedPnl?: string;
  status: PositionStatus;
  closingPrice?: string;
  closedAt?: Date;
  accumulatedFunding: string;
  accumulatedBorrowingFee: string;
  lastBorrowingFeeUpdate: Date;
  lastFundingUpdate: Date;
  createdAt: Date;
  updatedAt: Date;
}
