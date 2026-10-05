import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { envValidationSchema } from './config/env.validation';
import { DomainEventsModule } from './common/events/domain-events.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { WalletsModule } from './wallets/wallets.module';
import { DepositsModule } from './deposits/deposits.module';
import { MediaModule } from './media/media.module';
import { SettingsModule } from './settings/settings.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AuditModule } from './audit/audit.module';
import { AdminOpsModule } from './admin-ops/admin-ops.module';
import { HealthModule } from './health/health.module';
import { MeModule } from './me/me.module';
import { LotteriesModule } from './lotteries/lotteries.module';
import { TicketsModule } from './tickets/tickets.module';
import { DrawModule } from './draw/draw.module';
import { WinnersModule } from './winners/winners.module';
import { ReferralsModule } from './referrals/referrals.module';
import { WebsocketModule } from './websocket/websocket.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
    }),
    EventEmitterModule.forRoot({ wildcard: false }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    DomainEventsModule,
    PrismaModule,
    AuthModule,
    UsersModule,
    WalletsModule,
    DepositsModule,
    MediaModule,
    SettingsModule,
    NotificationsModule,
    AuditModule,
    AdminOpsModule,
    HealthModule,
    LotteriesModule,
    TicketsModule,
    DrawModule,
    WinnersModule,
    ReferralsModule,
    WebsocketModule,
    MeModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
