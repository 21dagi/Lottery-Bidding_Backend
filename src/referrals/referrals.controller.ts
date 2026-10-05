import {
  Body,
  Controller,
  Get,
  Put,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsNumber, Min } from 'class-validator';
import { ReferralsService } from './referrals.service';
import { AdminJwtGuard } from '../common/guards/admin-jwt.guard';
import { AuditInterceptor } from '../common/interceptors/audit.interceptor';

class UpdateRulesDto {
  @IsBoolean()
  enabled!: boolean;

  @IsNumber()
  @Min(0)
  purchasePercent!: number;

  @IsNumber()
  @Min(0)
  depositFlatEtb!: number;
}

@ApiTags('admin-referrals')
@ApiBearerAuth()
@UseGuards(AdminJwtGuard)
@UseInterceptors(AuditInterceptor)
@Controller('admin/referrals')
export class ReferralsAdminController {
  constructor(private readonly referrals: ReferralsService) {}

  @Get('rules')
  getRules() {
    return this.referrals.getRules();
  }

  @Put('rules')
  updateRules(@Body() dto: UpdateRulesDto) {
    return this.referrals.updateRules(dto);
  }

  @Get('rewards')
  rewards(@Query('page') page?: number, @Query('pageSize') pageSize?: number) {
    return this.referrals.listRewards({ page, pageSize });
  }
}
