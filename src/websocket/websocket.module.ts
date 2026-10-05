import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { LotteryGateway } from './lottery.gateway';
import { AdminDashboardGateway } from './admin-dashboard.gateway';

@Module({
  imports: [JwtModule.register({})],
  providers: [LotteryGateway, AdminDashboardGateway],
})
export class WebsocketModule {}
