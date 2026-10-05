import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { PaymentMethod } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import { UserJwtGuard } from '../common/guards/user-jwt.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UsersService } from '../users/users.service';
import { WalletsService } from '../wallets/wallets.service';
import { DepositsService } from '../deposits/deposits.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TicketsService } from '../tickets/tickets.service';
import { ReferralsService } from '../referrals/referrals.service';
import { LotteriesService } from '../lotteries/lotteries.service';
import { toEtbNumber } from '../common/utils/money';

class UpdatePhoneDto {
  @IsString()
  phoneNumber!: string;
}

class CreateDepositDto {
  @IsNumber()
  @Min(2)
  amountEtb!: number;

  @IsEnum(PaymentMethod)
  method!: PaymentMethod;

  @IsOptional()
  @ValidateIf((_, v) => v !== undefined && v !== null && v !== '')
  @IsString()
  mediaId?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== undefined && v !== null && v !== '')
  @IsString()
  @MinLength(4)
  externalReference?: string;
}

@ApiTags('me')
@ApiBearerAuth()
@UseGuards(UserJwtGuard)
@Controller('me')
export class MeController {
  constructor(
    private readonly users: UsersService,
    private readonly wallets: WalletsService,
    private readonly deposits: DepositsService,
    private readonly notifications: NotificationsService,
    private readonly tickets: TicketsService,
    private readonly referrals: ReferralsService,
    private readonly lotteries: LotteriesService,
  ) {}

  @Get()
  async me(@CurrentUser() user: { id: string }) {
    const u = await this.users.getById(user.id);
    return this.users.toUserDto(
      u,
      toEtbNumber(u.wallet?.cachedBalance ?? 0),
    );
  }

  @Get('home')
  async home(@CurrentUser() user: { id: string }) {
    const [wallet, active, featured, ledger] = await Promise.all([
      this.wallets.getWalletForUser(user.id),
      this.tickets.listMine(user.id, 'active'),
      this.lotteries.listPublic('live', 1, 5),
      this.wallets.listTransactions(user.id, { page: 1, pageSize: 5 }),
    ]);
    return {
      balanceEtb: wallet.balanceEtb,
      activeEntries: active,
      featuredLotteries: featured.items,
      recentLedger: ledger.items,
    };
  }

  @Patch('phone')
  updatePhone(
    @CurrentUser() user: { id: string },
    @Body() dto: UpdatePhoneDto,
  ) {
    return this.users.updatePhone(user.id, dto.phoneNumber);
  }

  @Get('wallet')
  wallet(@CurrentUser() user: { id: string }) {
    return this.wallets.getWalletForUser(user.id);
  }

  @Get('wallet/transactions')
  walletTx(
    @CurrentUser() user: { id: string },
    @Query('type') type?: string,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
  ) {
    return this.wallets.listTransactions(user.id, { type, page, pageSize });
  }

  @Get('deposits')
  depositsList(@CurrentUser() user: { id: string }) {
    return this.deposits.listMine(user.id);
  }

  @Post('deposits')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  createDeposit(
    @CurrentUser() user: { id: string },
    @Body() dto: CreateDepositDto,
  ) {
    return this.deposits.submit(user.id, dto);
  }

  @Get('tickets')
  myTickets(
    @CurrentUser() user: { id: string },
    @Query('tab') tab?: 'active' | 'won' | 'history',
  ) {
    return this.tickets.listMine(user.id, tab || 'active');
  }

  @Get('referrals')
  myReferrals(@CurrentUser() user: { id: string }) {
    return this.referrals.myReferrals(user.id);
  }

  @Get('notifications')
  notificationsList(
    @CurrentUser() user: { id: string },
    @Query('unreadOnly') unreadOnly?: string,
  ) {
    return this.notifications.listForUser(
      user.id,
      unreadOnly === 'true' || unreadOnly === '1',
    );
  }

  @Post('notifications/read-all')
  readAll(@CurrentUser() user: { id: string }) {
    return this.notifications.markAllRead(user.id);
  }

  @Post('notifications/:id/read')
  readOne(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.notifications.markRead(user.id, id);
  }
}
