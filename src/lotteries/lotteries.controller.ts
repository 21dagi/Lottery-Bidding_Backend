import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { LotteriesService } from './lotteries.service';
import { AdminJwtGuard } from '../common/guards/admin-jwt.guard';
import { AuditInterceptor } from '../common/interceptors/audit.interceptor';
import { CurrentAdmin } from '../common/decorators/current-user.decorator';

class PrizeDto {
  @IsIn([1, 2, 3])
  place!: 1 | 2 | 3;

  @IsIn(['money', 'product'])
  kind!: 'money' | 'product';

  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  subtitle?: string;

  @IsOptional()
  @IsString()
  detail?: string;

  @IsOptional()
  @IsNumber()
  amountEtb?: number;

  @IsOptional()
  @IsString()
  imageMediaId?: string;

  @IsOptional()
  specs?: { label: string; value: string }[];

  @IsOptional()
  @IsString()
  fulfillmentNote?: string;
}

class CreateLotteryDto {
  @IsString()
  title!: string;

  @IsString()
  seriesLabel!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  @Min(0.01)
  ticketPriceEtb!: number;

  @IsNumber()
  @Min(1)
  totalTickets!: number;

  @IsString()
  closesAt!: string;

  @IsOptional()
  @IsString()
  coverMediaId?: string;

  @IsOptional()
  @IsBoolean()
  publish?: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PrizeDto)
  prizes!: PrizeDto[];
}

class PatchLotteryDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  seriesLabel?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  closesAt?: string;

  @IsOptional()
  @IsString()
  coverMediaId?: string;
}

class ReasonDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

@ApiTags('admin-lotteries')
@ApiBearerAuth()
@UseGuards(AdminJwtGuard)
@UseInterceptors(AuditInterceptor)
@Controller('admin/lotteries')
export class LotteriesAdminController {
  constructor(private readonly lotteries: LotteriesService) {}

  @Get()
  list(@Query('page') page?: number, @Query('pageSize') pageSize?: number) {
    return this.lotteries.listAdmin({ page, pageSize });
  }

  @Post()
  create(
    @Body() dto: CreateLotteryDto,
    @CurrentAdmin() admin: { id: string },
  ) {
    return this.lotteries.create(admin.id, dto);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.lotteries.toAdminDetail(id);
  }

  @Patch(':id')
  patch(@Param('id') id: string, @Body() dto: PatchLotteryDto) {
    return this.lotteries.patch(id, dto);
  }

  @Post(':id/publish')
  publish(@Param('id') id: string, @CurrentAdmin() admin: { id: string }) {
    return this.lotteries.publish(id, admin.id);
  }

  @Post(':id/lock')
  lock(
    @Param('id') id: string,
    @CurrentAdmin() admin: { id: string },
    @Body() dto: ReasonDto,
  ) {
    return this.lotteries.lock(id, admin.id, dto.reason);
  }

  @Post(':id/cancel')
  cancel(
    @Param('id') id: string,
    @CurrentAdmin() admin: { id: string },
    @Body() dto: ReasonDto,
  ) {
    return this.lotteries.cancel(id, admin.id, dto.reason);
  }
}

@ApiTags('lotteries')
@Controller('lotteries')
export class LotteriesPublicController {
  constructor(
    private readonly lotteries: LotteriesService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  list(
    @Query('tab') tab: 'live' | 'finished' = 'live',
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
  ) {
    return this.lotteries.listPublic(tab || 'live', page, pageSize);
  }

  @Get(':id/archive')
  archive(@Param('id') id: string) {
    return this.lotteries.getArchive(id);
  }

  @Get(':id')
  async detail(
    @Param('id') id: string,
    @Req() req: Request & { headers: { authorization?: string } },
  ) {
    const userId = await this.optionalUserId(req.headers.authorization);
    return this.lotteries.getPublicDetail(id, userId);
  }

  private async optionalUserId(authorization?: string) {
    if (!authorization?.startsWith('Bearer ')) return undefined;
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; typ: string }>(
        authorization.slice(7),
        { secret: this.config.getOrThrow<string>('USER_JWT_SECRET') },
      );
      return payload.typ === 'user' ? payload.sub : undefined;
    } catch {
      return undefined;
    }
  }
}
