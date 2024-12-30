import { Controller, Sse, Query } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { EventsService } from './events.service';

@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Sse('positions')
  positions(@Query('userId') userId: string): Observable<MessageEvent> {
    return this.eventsService.getPositionsEventObservable(userId).pipe(
      map(
        (update) =>
          ({
            data: {
              userId: update.userId,
              timestamp: update.timestamp,
            },
          }) as MessageEvent,
      ),
    );
  }
}
