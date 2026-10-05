import { Module } from '@nestjs/common';
import { AdminOpsController } from './admin-ops.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [AdminOpsController],
})
export class AdminOpsModule {}
