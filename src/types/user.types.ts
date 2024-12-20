export interface UserBalance {
  userId: string;
  availableBalance: string;
  totalBalance: string;
  lockedMargin: string;
  unrealizedPnl: string;
  updatedAt: Date;
}

export interface MarginLock {
  userId: string;
  positionId: string;
  amount: string;
  createdAt: Date;
}
