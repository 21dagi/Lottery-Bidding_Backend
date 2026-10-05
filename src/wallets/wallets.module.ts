import { Module } from '@nestjs/common';
import { WalletsService } from './wallets.service';
import { WalletsAdminController } from './wallets.admin.controller';

@Module({
  controllers: [WalletsAdminController],
  providers: [WalletsService],
  exports: [WalletsService],
})
export class WalletsModule {}
