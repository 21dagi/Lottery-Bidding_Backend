import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersAdminController } from './users.admin.controller';

@Module({
  controllers: [UsersAdminController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
