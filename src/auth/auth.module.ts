import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { UsersModule } from '../users/users.module';
import { ReferralsModule } from '../referrals/referrals.module';
import { UserJwtGuard } from '../common/guards/user-jwt.guard';
import { AdminJwtGuard } from '../common/guards/admin-jwt.guard';

@Global()
@Module({
  imports: [JwtModule.register({}), UsersModule, ReferralsModule],
  controllers: [AuthController],
  providers: [AuthService, UserJwtGuard, AdminJwtGuard],
  exports: [AuthService, JwtModule, UserJwtGuard, AdminJwtGuard],
})
export class AuthModule {}
