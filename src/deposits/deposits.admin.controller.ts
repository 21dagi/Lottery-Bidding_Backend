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
import { DepositStatus } from '@prisma/client';
import { IsOptional, IsString, MinLength } from 'class-validator';
import { DepositsService } from './deposits.service';
import { AdminJwtGuard } from '../common/guards/admin-jwt.guard';
import { AuditInterceptor } from '../common/interceptors/audit.interceptor';
import { CurrentAdmin } from '../common/decorators/current-user.decorator';

class RejectDepositDto {
  @IsString()
  @MinLength(1)
  reason!: string;
}

class ListDepositsQuery {
  @IsOptional()
  @IsString()
  status?: DepositStatus;

  @IsOptional()
  page?: number;

  @IsOptional()
  pageSize?: number;
}

@ApiTags('admin-deposits')
@ApiBearerAuth()
@UseGuards(AdminJwtGuard)
@UseInterceptors(AuditInterceptor)
@Controller('admin/deposits')
export class DepositsAdminController {
  constructor(private readonly deposits: DepositsService) {}

  @Get()
  list(@Query() query: ListDepositsQuery) {
    return this.deposits.listAdmin(query);
  }

  @Post(':id/approve')
  approve(@Param('id') id: string, @CurrentAdmin() admin: { id: string }) {
    return this.deposits.approve(id, admin.id);
  }

  @Post(':id/reject')
  reject(
    @Param('id') id: string,
    @Body() dto: RejectDepositDto,
    @CurrentAdmin() admin: { id: string },
  ) {
    return this.deposits.reject(id, admin.id, dto.reason);
  }
}
