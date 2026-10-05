import { Module } from '@nestjs/common';
import { DrawService } from './draw.service';
import { DrawAdminController } from './draw.controller';

@Module({
  controllers: [DrawAdminController],
  providers: [DrawService],
  exports: [DrawService],
})
export class DrawModule {}
