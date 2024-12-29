import { TokenType } from 'src/types/token.types';
import { User } from 'src/user/types/user.types';

export interface MarginBalance {
  id: string;
  userId: string;
  user: User;
  token: TokenType;
  availableBalance: string;
  lockedBalance: string;
  unrealizedPnl: string;
  createdAt: Date;
  updatedAt: Date;
}
