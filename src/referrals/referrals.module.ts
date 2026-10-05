import { Module } from '@nestjs/common';
import { ReferralsService } from './referrals.service';
import { ReferralsListener } from './referrals.listener';
import { ReferralsAdminController } from './referrals.controller';

@Module({
  controllers: [ReferralsAdminController],
  providers: [ReferralsService, ReferralsListener],
  exports: [ReferralsService],
})
export class ReferralsModule {}
