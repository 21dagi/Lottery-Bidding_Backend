import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { LotteriesService } from './lotteries.service';
import {
  LotteriesAdminController,
  LotteriesPublicController,
} from './lotteries.controller';
import { LotteryHistoryListener } from './listeners/lottery-history.listener';

@Module({
  imports: [JwtModule.register({})],
  controllers: [LotteriesAdminController, LotteriesPublicController],
  providers: [LotteriesService, LotteryHistoryListener],
  exports: [LotteriesService],
})
export class LotteriesModule {}
