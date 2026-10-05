import { Module } from '@nestjs/common';
import { MeController } from './me.controller';
import { UsersModule } from '../users/users.module';
import { WalletsModule } from '../wallets/wallets.module';
import { DepositsModule } from '../deposits/deposits.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuthModule } from '../auth/auth.module';
import { TicketsModule } from '../tickets/tickets.module';
import { ReferralsModule } from '../referrals/referrals.module';
import { LotteriesModule } from '../lotteries/lotteries.module';

@Module({
  imports: [
    AuthModule,
    UsersModule,
    WalletsModule,
    DepositsModule,
    NotificationsModule,
    TicketsModule,
    ReferralsModule,
    LotteriesModule,
  ],
  controllers: [MeController],
})
export class MeModule {}
