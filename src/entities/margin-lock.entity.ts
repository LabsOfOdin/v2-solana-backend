import { TokenType } from 'src/types/token.types';

export interface MarginLock {
  id: string;
  userId: string;
  tradeId: string;
  token: TokenType;
  amount: string;
  createdAt: Date;
  updatedAt: Date;
}
