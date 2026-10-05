import { Logger, OnModuleInit } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { OnEvent } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Server, Socket } from 'socket.io';
import {
  DOMAIN_EVENTS,
  TicketPurchasedPayload,
  TicketReservationExpiredPayload,
  TicketReservedPayload,
  WinnerSelectedPayload,
} from '../common/events/event-names';

@WebSocketGateway({
  namespace: '/ws/lottery',
  cors: { origin: true, credentials: true },
})
export class LotteryGateway
  implements OnGatewayConnection, OnModuleInit
{
  private readonly logger = new Logger(LotteryGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    this.logger.log('Lottery websocket gateway ready (/ws/lottery)');
  }

  async handleConnection(client: Socket) {
    try {
      const token =
        (client.handshake.auth?.token as string) ||
        (client.handshake.headers.authorization || '').replace('Bearer ', '');
      if (!token) {
        client.disconnect();
        return;
      }
      const payload = await this.jwt.verifyAsync<{ sub: string; typ: string }>(
        token,
        { secret: this.config.getOrThrow<string>('USER_JWT_SECRET') },
      );
      if (payload.typ !== 'user') {
        client.disconnect();
        return;
      }
      client.data.userId = payload.sub;
    } catch {
      client.disconnect();
    }
  }

  @SubscribeMessage('join')
  handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { lotteryId: string },
  ) {
    if (!body?.lotteryId) return;
    void client.join(`lottery:${body.lotteryId}`);
    return { ok: true, room: `lottery:${body.lotteryId}` };
  }

  @SubscribeMessage('leave')
  handleLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { lotteryId: string },
  ) {
    if (!body?.lotteryId) return;
    void client.leave(`lottery:${body.lotteryId}`);
    return { ok: true };
  }

  @OnEvent(DOMAIN_EVENTS.TICKET_RESERVED)
  onReserved(payload: TicketReservedPayload) {
    for (const t of payload.tickets) {
      this.server
        .to(`lottery:${payload.lotteryId}`)
        .emit('ticket:update', {
          ticketNumber: t.ticketNumber,
          status: 'RESERVED',
          expiresAt: t.expiresAt,
        });
    }
  }

  @OnEvent(DOMAIN_EVENTS.TICKET_RESERVATION_EXPIRED)
  onExpired(payload: TicketReservationExpiredPayload) {
    for (const t of payload.tickets) {
      this.server
        .to(`lottery:${payload.lotteryId}`)
        .emit('ticket:update', {
          ticketNumber: t.ticketNumber,
          status: 'AVAILABLE',
        });
    }
  }

  @OnEvent(DOMAIN_EVENTS.TICKET_PURCHASED)
  onPurchased(payload: TicketPurchasedPayload) {
    for (const n of payload.ticketNumbers) {
      this.server
        .to(`lottery:${payload.lotteryId}`)
        .emit('ticket:update', {
          ticketNumber: n,
          status: 'SOLD',
        });
    }
  }

  @OnEvent(DOMAIN_EVENTS.WINNER_SELECTED)
  onWinner(payload: WinnerSelectedPayload) {
    this.server.to(`lottery:${payload.lotteryId}`).emit('ticket:update', {
      ticketNumber: payload.ticketNumber,
      status: 'SOLD',
      winner: true,
      place: payload.place,
    });
  }
}
