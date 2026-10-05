import { Logger, OnModuleInit } from '@nestjs/common';
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { OnEvent } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import {
  DOMAIN_EVENTS,
  DepositSubmittedPayload,
  TicketPurchasedPayload,
} from '../common/events/event-names';
import { DepositStatus, LotteryStatus, TicketStatus } from '@prisma/client';

@WebSocketGateway({
  namespace: '/ws/admin',
  cors: { origin: true, credentials: true },
})
export class AdminDashboardGateway
  implements OnGatewayConnection, OnModuleInit
{
  private readonly logger = new Logger(AdminDashboardGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    this.logger.log('Admin websocket gateway ready (/ws/admin)');
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
        { secret: this.config.getOrThrow<string>('ADMIN_JWT_SECRET') },
      );
      if (payload.typ !== 'admin') {
        client.disconnect();
        return;
      }
      client.data.adminId = payload.sub;
      void client.join('admin');
    } catch {
      client.disconnect();
    }
  }

  @OnEvent(DOMAIN_EVENTS.DEPOSIT_SUBMITTED)
  async onDepositSubmitted(_p: DepositSubmittedPayload) {
    const pendingDeposits = await this.prisma.deposit.count({
      where: { status: DepositStatus.PENDING },
    });
    this.server.to('admin').emit('deposits:pending_count', { pendingDeposits });
  }

  @OnEvent(DOMAIN_EVENTS.DEPOSIT_APPROVED)
  async onDepositApproved() {
    await this.emitPendingDeposits();
  }

  @OnEvent(DOMAIN_EVENTS.DEPOSIT_REJECTED)
  async onDepositRejected() {
    await this.emitPendingDeposits();
  }

  private async emitPendingDeposits() {
    const pendingDeposits = await this.prisma.deposit.count({
      where: { status: DepositStatus.PENDING },
    });
    this.server.to('admin').emit('deposits:pending_count', { pendingDeposits });
  }

  @OnEvent(DOMAIN_EVENTS.TICKET_PURCHASED)
  async onPurchase(payload: TicketPurchasedPayload) {
    const [liveLotteries, ticketsSold] = await Promise.all([
      this.prisma.lottery.count({
        where: {
          status: { in: [LotteryStatus.OPEN, LotteryStatus.PUBLISHED] },
        },
      }),
      this.prisma.ticket.count({ where: { status: TicketStatus.SOLD } }),
    ]);
    this.server.to('admin').emit('lottery:sales', {
      lotteryId: payload.lotteryId,
      ticketsSold,
      liveLotteries,
      totalAmountEtb: payload.totalAmountEtb,
    });
  }
}
