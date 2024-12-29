import { TokenType } from 'src/types/token.types';

export enum WithdrawalStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  REJECTED = 'REJECTED',
}

export interface WithdrawalRequest {
  id: string;
  userId: string;
  amount: string;
  token: TokenType;
  destinationAddress: string;
  status: WithdrawalStatus;
  txHash?: string;
  processingNotes?: string;
  createdAt: Date;
  updatedAt: Date;
}
