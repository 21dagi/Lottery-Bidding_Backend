import { Module } from '@nestjs/common';
import { WinnersService } from './winners.service';
import { WinnersAdminController } from './winners.controller';

@Module({
  controllers: [WinnersAdminController],
  providers: [WinnersService],
  exports: [WinnersService],
})
export class WinnersModule {}
