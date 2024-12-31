import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';
import { filter } from 'rxjs/operators';
import { TokenType } from 'src/types/token.types';

interface BorrowingFeeEvent {
  userId: string;
  positionId: string;
  marketId: string;
  feeUsd: string;
  feeToken: string;
  token: TokenType;
}

interface PositionUpdate {
  userId: string;
  timestamp: string;
}

interface FundingFeeEvent {
  userId: string;
  positionId: string;
  marketId: string;
  feeUsd: string;
  feeToken: string;
  token: TokenType;
}

@Injectable()
export class EventsService {
  private positionsSubject = new Subject<PositionUpdate>();
  private balancesSubject = new Subject<{
    userId: string;
    timestamp: string;
  }>();

  getPositionsEventObservable(userId: string) {
    return this.positionsSubject
      .asObservable()
      .pipe(filter((update) => update.userId === userId));
  }

  getBalancesEventObservable(userId: string) {
    return this.balancesSubject
      .asObservable()
      .pipe(filter((update) => update.userId === userId));
  }

  emitPositionsUpdate(userId: string) {
    this.positionsSubject.next({
      userId,
      timestamp: new Date().toISOString(),
    });
  }

  emitBorrowingFeeCharged(event: BorrowingFeeEvent): void {
    // In production, this would emit the event to a message queue or websocket
    console.log('Borrowing fee charged:', event);
  }

  emitBalancesUpdate(userId: string) {
    this.balancesSubject.next({
      userId,
      timestamp: new Date().toISOString(),
    });
  }

  emitFundingFeeCharged(event: FundingFeeEvent): void {
    // In production, this would emit the event to a message queue or websocket
    console.log('Funding fee charged:', event);
  }
}
