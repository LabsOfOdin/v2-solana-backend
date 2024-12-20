import { TokenType } from '../margin/types/token.types';

export enum OrderType {
  MARKET = 'MARKET',
  LIMIT = 'LIMIT',
  STOP_MARKET = 'STOP_MARKET',
  TAKE_PROFIT_MARKET = 'TAKE_PROFIT_MARKET',
}

export enum OrderSide {
  LONG = 'LONG',
  SHORT = 'SHORT',
}

export enum MarginType {
  ISOLATED = 'ISOLATED',
  CROSS = 'CROSS',
}

export enum OrderStatus {
  OPEN = 'OPEN',
  FILLED = 'FILLED',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
  PARTIALLY_FILLED = 'PARTIALLY_FILLED',
}

export interface OrderRequest {
  id: string;
  userId: string;
  marketId: string;
  side: OrderSide;
  type: OrderType;
  size: string;
  price?: string;
  leverage: string;
  marginType: MarginType;
  stopLossPrice?: string;
  takeProfitPrice?: string;
  token: TokenType;
}

export interface UpdatePositionRequest {
  stopLossPrice?: string;
  takeProfitPrice?: string;
  trailingStopDistance?: string;
}

export interface PartialCloseRequest {
  size: string;
  price?: string;
  type: OrderType;
  stopLossPrice?: string;
  takeProfitPrice?: string;
}

export interface Trade {
  id: string;
  positionId: string;
  userId: string;
  marketId: string;
  side: OrderSide;
  size: string;
  price: string;
  leverage: string;
  marginType: MarginType;
  realizedPnl?: string;
  fee: string;
  createdAt: Date;
  type: OrderType;
  isPartialClose?: boolean;
}
