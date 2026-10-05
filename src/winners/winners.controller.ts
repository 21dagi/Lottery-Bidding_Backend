import {
  Body,
  Controller,
  Param,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { PayoutStatus } from '@prisma/client';
import { WinnersService } from './winners.service';
import { AdminJwtGuard } from '../common/guards/admin-jwt.guard';
import { AuditInterceptor } from '../common/interceptors/audit.interceptor';
import { CurrentAdmin } from '../common/decorators/current-user.decorator';

class FulfillDto {
  @IsEnum(PayoutStatus)
  status!: PayoutStatus;

  @IsOptional()
  @IsString()
  evidenceMediaId?: string;

  /** Admin UI may send a free-form evidence URL; stored in payout notes. */
  @IsOptional()
  @IsString()
  evidenceUrl?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

@ApiTags('admin-winners')
@ApiBearerAuth()
@UseGuards(AdminJwtGuard)
@UseInterceptors(AuditInterceptor)
@Controller('admin/lotteries/:id/winners')
export class WinnersAdminController {
  constructor(private readonly winners: WinnersService) {}

  @Post(':winnerId/fulfill')
  fulfill(
    @Param('id') lotteryId: string,
    @Param('winnerId') winnerId: string,
    @Body() dto: FulfillDto,
    @CurrentAdmin() admin: { id: string },
  ) {
    const notes =
      dto.notes?.trim() ||
      (dto.evidenceUrl?.trim() ? `Evidence: ${dto.evidenceUrl.trim()}` : undefined);
    return this.winners.fulfill(lotteryId, winnerId, admin.id, {
      status: dto.status,
      evidenceMediaId: dto.evidenceMediaId,
      notes,
    });
  }
}
