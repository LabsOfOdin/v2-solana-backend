import { TokenType } from './token.types';

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

export enum OrderStatus {
  OPEN = 'OPEN',
  FILLED = 'FILLED',
  CANCELLED = 'CANCELLED',
}

export interface OrderRequest {
  id: string;
  userId: string;
  marketId: string;
  side: OrderSide;
  size: string;
  leverage: string;
  token: TokenType;
  positionId?: string;
  stopLossPrice?: string;
  takeProfitPrice?: string;
  trailingStopDistance?: string;
}

export interface LimitOrderRequest extends OrderRequest {
  price: string;
  type: OrderType;
}

export interface UpdatePositionRequest {
  stopLossPrice?: string;
  takeProfitPrice?: string;
  trailingStopDistance?: string;
}

export interface PartialCloseRequest {
  sizeDelta: string;
  price?: string;
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
  realizedPnl?: string;
  fee: string;
  createdAt: Date;
  isPartialClose?: boolean;
}
