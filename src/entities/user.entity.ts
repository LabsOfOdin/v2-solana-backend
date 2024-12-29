import { Position } from './position.entity';
import { MarginLock } from './margin-lock.entity';
import { LPPosition } from './lp-position.entity';
import { MarginBalance } from 'src/entities/margin-balance.entity';
import { LimitOrder } from './limit-order.entity';

export interface User {
  publicKey: string;
  positions: Position[];
  marginLocks: MarginLock[];
  lpPositions: LPPosition[];
  marginBalances: MarginBalance[];
  limitOrders: LimitOrder[];
  createdAt: Date;
  updatedAt: Date;
}
