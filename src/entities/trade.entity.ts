import { OrderSide } from '../types/trade.types';

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
}
