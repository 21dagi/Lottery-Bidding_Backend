import { Module } from '@nestjs/common';
import { TicketsService } from './tickets.service';
import {
  TicketsAdminController,
  TicketsUserController,
} from './tickets.controller';
import { LotteriesModule } from '../lotteries/lotteries.module';

@Module({
  imports: [LotteriesModule],
  controllers: [TicketsUserController, TicketsAdminController],
  providers: [TicketsService],
  exports: [TicketsService],
})
export class TicketsModule {}
