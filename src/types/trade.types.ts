export enum OrderType {
  MARKET = 'MARKET',
  LIMIT = 'LIMIT',
  STOP_LOSS = 'STOP_LOSS',
  TAKE_PROFIT = 'TAKE_PROFIT',
  TRAILING_STOP = 'TRAILING_STOP',
  LIQUIDATION = 'LIQUIDATION',
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
  userId: string;
  marketId: string;
  side: OrderSide;
  size: string;
  type: OrderType;
  price?: string;
  leverage: string;
  marginType: MarginType;
  stopLossPrice?: string;
  takeProfitPrice?: string;
  trailingStopDistance?: string;
  partialSize?: string;
  isReduceOnly?: boolean;
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

export interface Position {
  id: string;
  userId: string;
  marketId: string;
  side: OrderSide;
  size: string;
  entryPrice: string;
  leverage: string;
  marginType: MarginType;
  liquidationPrice: string;
  stopLossPrice?: string;
  takeProfitPrice?: string;
  trailingStopDistance?: string;
  highestPrice?: string;
  lowestPrice?: string;
  unrealizedPnl: string;
  margin: string;
  createdAt: Date;
  updatedAt: Date;
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
