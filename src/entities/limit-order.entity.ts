import { OrderSide, OrderStatus } from '../types/trade.types';
import { TokenType } from 'src/types/token.types';

export interface LimitOrder {
  id: string;
  userId: string;
  marketId: string;
  side: OrderSide;
  size: string;
  price: string;
  leverage: string;
  token: TokenType;
  symbol: string;
  requiredMargin: string;
  status: OrderStatus;
  createdAt: Date;
  updatedAt: Date;
}
