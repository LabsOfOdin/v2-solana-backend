import { TokenType } from 'src/types/token.types';

export interface User {
  publicKey: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserWithRelations extends User {
  positions?: Position[];
  marginLocks?: MarginLock[];
  lpPositions?: LPPosition[];
  marginBalances?: MarginBalance[];
  limitOrders?: LimitOrder[];
}

export interface MarginLock {
  id: string;
  userId: string;
  tradeId: string;
  token: TokenType;
  amount: string;
  createdAt: Date;
}

// These are placeholder interfaces that would be imported from their respective modules
interface Position {}
interface LPPosition {}
interface MarginBalance {}
interface LimitOrder {}
