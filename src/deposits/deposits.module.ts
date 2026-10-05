import { Module } from '@nestjs/common';
import { DepositsService } from './deposits.service';
import { DepositsAdminController } from './deposits.admin.controller';
import { WalletsModule } from '../wallets/wallets.module';
import { SettingsModule } from '../settings/settings.module';
import { LinksEtClient } from './verification/links-et.client';
import { LinksEtPaymentVerificationProvider } from './verification/links-et.provider';
import { PAYMENT_VERIFICATION_PROVIDER } from './verification/payment-verification.provider';

@Module({
  imports: [WalletsModule, SettingsModule],
  controllers: [DepositsAdminController],
  providers: [
    DepositsService,
    LinksEtClient,
    {
      provide: PAYMENT_VERIFICATION_PROVIDER,
      useClass: LinksEtPaymentVerificationProvider,
    },
  ],
  exports: [DepositsService],
})
export class DepositsModule {}
