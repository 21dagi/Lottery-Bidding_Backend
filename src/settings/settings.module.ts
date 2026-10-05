import { Module } from '@nestjs/common';
import { SettingsService } from './settings.service';
import {
  PaymentsController,
  SettingsAdminController,
} from './settings.controller';

@Module({
  controllers: [SettingsAdminController, PaymentsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
