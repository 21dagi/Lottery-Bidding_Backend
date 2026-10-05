import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DomainEventName } from './event-names';

/**
 * Thin wrapper: always emit AFTER the calling service has committed DB work.
 * Listeners must be idempotent.
 */
@Injectable()
export class DomainEventsService {
  private readonly logger = new Logger(DomainEventsService.name);

  constructor(private readonly emitter: EventEmitter2) {}

  emitAfterCommit<T>(event: DomainEventName, payload: T): void {
    setImmediate(() => {
      try {
        this.emitter.emit(event, payload);
      } catch (err) {
        this.logger.error(
          `Listener failure for ${event}: ${(err as Error).message}`,
          (err as Error).stack,
        );
      }
    });
  }

  /** Emit several events after a successful commit (order preserved). */
  emitManyAfterCommit(
    events: Array<{ name: DomainEventName; payload: unknown }>,
  ): void {
    setImmediate(() => {
      for (const e of events) {
        try {
          this.emitter.emit(e.name, e.payload);
        } catch (err) {
          this.logger.error(
            `Listener failure for ${e.name}: ${(err as Error).message}`,
            (err as Error).stack,
          );
        }
      }
    });
  }
}
