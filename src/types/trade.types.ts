export enum OrderType {
  MARKET = 'MARKET',
  LIMIT = 'LIMIT',
}

export enum OrderSide {
  LONG = 'LONG',
  SHORT = 'SHORT',
}

export enum MarginType {
  ISOLATED = 'ISOLATED',
  CROSS = 'CROSS',
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
}
