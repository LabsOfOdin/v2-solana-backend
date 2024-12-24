import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';
import { Position } from '../entities/position.entity';

@Injectable()
export class EventsService {
  private positionsSubject = new Subject<void>();

  getPositionsEventObservable() {
    return this.positionsSubject.asObservable();
  }

  emitPositionsUpdate() {
    this.positionsSubject.next();
  }
}
