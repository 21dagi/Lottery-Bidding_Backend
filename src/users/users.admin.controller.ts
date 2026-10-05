import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';
import { UsersService } from './users.service';
import { AdminJwtGuard } from '../common/guards/admin-jwt.guard';
import { AuditInterceptor } from '../common/interceptors/audit.interceptor';

class BanUserDto {
  @IsString()
  @MinLength(1)
  reason!: string;
}

class ListUsersQuery {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsString()
  status?: 'ACTIVE' | 'BANNED';

  @IsOptional()
  page?: number;

  @IsOptional()
  pageSize?: number;
}

@ApiTags('admin-users')
@ApiBearerAuth()
@UseGuards(AdminJwtGuard)
@UseInterceptors(AuditInterceptor)
@Controller('admin/users')
export class UsersAdminController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(@Query() query: ListUsersQuery) {
    return this.users.listAdmin(query);
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const user = await this.users.getById(id);
    return this.users.toAdminUserDto(user);
  }

  @Post(':id/ban')
  ban(@Param('id') id: string, @Body() dto: BanUserDto) {
    return this.users.ban(id, dto.reason);
  }

  @Post(':id/unban')
  unban(@Param('id') id: string) {
    return this.users.unban(id);
  }
}
