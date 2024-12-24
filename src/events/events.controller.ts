import { Controller, Sse } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { EventsService } from './events.service';

@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Sse('positions')
  positions(): Observable<MessageEvent> {
    return this.eventsService.getPositionsEventObservable().pipe(
      map(
        () =>
          ({
            data: { timestamp: new Date().toISOString() },
          }) as MessageEvent,
      ),
    );
  }
}
