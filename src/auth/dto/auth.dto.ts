import { IsOptional, IsString, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TelegramAuthDto {
  @ApiProperty()
  @IsString()
  @MinLength(10)
  initData!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  startParam?: string;
}

export class AdminLoginDto {
  @ApiProperty()
  @IsString()
  username!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  password!: string;
}

export class DevLoginDto {
  @ApiProperty({ example: '100001' })
  @IsString()
  telegramId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  displayName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  startParam?: string;
}
