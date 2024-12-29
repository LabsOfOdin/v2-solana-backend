import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';
import { Position } from '../entities/position.entity';
import { TokenType } from '../margin/types/token.types';

interface BorrowingFeeEvent {
  userId: string;
  positionId: string;
  marketId: string;
  feeUsd: string;
  feeToken: string;
  token: TokenType;
}

@Injectable()
export class EventsService {
  private positionsSubject = new Subject<void>();

  getPositionsEventObservable() {
    return this.positionsSubject.asObservable();
  }

  emitPositionsUpdate() {
    this.positionsSubject.next();
  }

  emitBorrowingFeeCharged(event: BorrowingFeeEvent): void {
    // In production, this would emit the event to a message queue or websocket
    console.log('Borrowing fee charged:', event);
  }
}
