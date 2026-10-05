import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Observable, tap } from 'rxjs';
import { DOMAIN_EVENTS } from '../events/event-names';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly events: EventEmitter2) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<{
      method: string;
      url: string;
      admin?: { id: string };
      body?: Record<string, unknown>;
      params?: Record<string, string>;
    }>();

    return next.handle().pipe(
      tap((result) => {
        if (!req.admin?.id) return;
        if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return;

        this.events.emit(DOMAIN_EVENTS.ADMIN_ACTION_PERFORMED, {
          actorId: req.admin.id,
          action: `${req.method} ${req.url}`,
          entityType: req.params?.id ? 'resource' : 'collection',
          entityId: req.params?.id ?? req.url,
          after: result ?? null,
          reason:
            typeof req.body?.reason === 'string' ? req.body.reason : undefined,
        });
      }),
    );
  }
}
