import {
  Body,
  Controller,
  Get,
  Put,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SettingsService } from './settings.service';
import { AdminJwtGuard } from '../common/guards/admin-jwt.guard';
import { AuditInterceptor } from '../common/interceptors/audit.interceptor';

class PaymentAccountDto {
  @IsString()
  method!: string;

  @IsString()
  label!: string;

  @IsString()
  value!: string;

  @IsBoolean()
  enabled!: boolean;
}

class UpdateSettingsDto {
  @IsString()
  botUsername!: string;

  @IsString()
  supportContact!: string;

  @IsString()
  paymentInstructions!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PaymentAccountDto)
  paymentAccounts!: PaymentAccountDto[];
}

@ApiTags('admin-settings')
@ApiBearerAuth()
@UseGuards(AdminJwtGuard)
@UseInterceptors(AuditInterceptor)
@Controller('admin/settings')
export class SettingsAdminController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  get() {
    return this.settings.get();
  }

  @Put()
  update(@Body() dto: UpdateSettingsDto) {
    return this.settings.update(dto);
  }
}

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly settings: SettingsService) {}

  @Get('methods')
  methods() {
    return this.settings.getPublicPaymentMethods();
  }
}
