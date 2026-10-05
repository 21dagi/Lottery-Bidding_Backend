import { Module } from '@nestjs/common';
import { DepositsService } from './deposits.service';
import { DepositsAdminController } from './deposits.admin.controller';
import { WalletsModule } from '../wallets/wallets.module';
import {
  ManualReviewProvider,
  PAYMENT_VERIFICATION_PROVIDER,
} from './verification/payment-verification.provider';

@Module({
  imports: [WalletsModule],
  controllers: [DepositsAdminController],
  providers: [
    DepositsService,
    { provide: PAYMENT_VERIFICATION_PROVIDER, useClass: ManualReviewProvider },
  ],
  exports: [DepositsService],
})
export class DepositsModule {}
