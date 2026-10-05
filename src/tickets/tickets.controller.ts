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
import {
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsString,
} from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import { TicketStatus } from '@prisma/client';
import { TicketsService } from './tickets.service';
import { UserJwtGuard } from '../common/guards/user-jwt.guard';
import { AdminJwtGuard } from '../common/guards/admin-jwt.guard';
import { CurrentUser, CurrentAdmin } from '../common/decorators/current-user.decorator';
import { AuditInterceptor } from '../common/interceptors/audit.interceptor';

class ReserveDto {
  @IsString()
  lotteryId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsNumber({}, { each: true })
  ticketNumbers!: number[];
}

class PurchaseDto {
  @IsString()
  lotteryId!: string;

  @IsString()
  reservationId!: string;
}

@ApiTags('tickets')
@ApiBearerAuth()
@UseGuards(UserJwtGuard)
@Controller('tickets')
export class TicketsUserController {
  constructor(private readonly tickets: TicketsService) {}

  @Post('reserve')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  reserve(@CurrentUser() user: { id: string }, @Body() dto: ReserveDto) {
    return this.tickets.reserve(user.id, dto.lotteryId, dto.ticketNumbers);
  }

  @Post('purchase')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  purchase(@CurrentUser() user: { id: string }, @Body() dto: PurchaseDto) {
    return this.tickets.purchase(user.id, dto.lotteryId, dto.reservationId);
  }
}

@ApiTags('admin-tickets')
@ApiBearerAuth()
@UseGuards(AdminJwtGuard)
@UseInterceptors(AuditInterceptor)
@Controller()
export class TicketsAdminController {
  constructor(private readonly tickets: TicketsService) {}

  @Get('admin/lotteries/:id/tickets')
  listForLottery(
    @Param('id') id: string,
    @Query('status') status?: TicketStatus,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
  ) {
    return this.tickets.listAdminTickets(id, { status, page, pageSize });
  }

  @Get('admin/tickets')
  list(
    @Query('lotteryId') lotteryId: string,
    @Query('status') status?: TicketStatus,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
  ) {
    return this.tickets.listAdminTickets(lotteryId, { status, page, pageSize });
  }
}
