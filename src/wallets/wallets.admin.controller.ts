import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, MinLength } from 'class-validator';
import { WalletsService } from './wallets.service';
import { AdminJwtGuard } from '../common/guards/admin-jwt.guard';
import { AuditInterceptor } from '../common/interceptors/audit.interceptor';
import { CurrentAdmin } from '../common/decorators/current-user.decorator';

class AdjustWalletDto {
  /** Admin UI sends `amount` (signed ETB). */
  @IsOptional()
  @IsNumber()
  amount?: number;

  /** Spec alias — accepted if `amount` omitted. */
  @IsOptional()
  @IsNumber()
  amountEtb?: number;

  @IsString()
  @MinLength(1)
  reason!: string;
}

@ApiTags('admin-wallets')
@ApiBearerAuth()
@UseGuards(AdminJwtGuard)
@UseInterceptors(AuditInterceptor)
@Controller('admin/wallets')
export class WalletsAdminController {
  constructor(private readonly wallets: WalletsService) {}

  @Get()
  list(@Query('page') page?: number, @Query('pageSize') pageSize?: number) {
    return this.wallets.listAdmin({ page, pageSize });
  }

  @Post(':userId/adjust')
  adjust(
    @Param('userId') userId: string,
    @Body() dto: AdjustWalletDto,
    @CurrentAdmin() admin: { id: string },
  ) {
    const amount = dto.amount !== undefined ? dto.amount : dto.amountEtb;
    if (amount === undefined) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'amount (or amountEtb) is required',
      });
    }
    return this.wallets.adminAdjust(userId, amount, dto.reason, admin.id);
  }
}
