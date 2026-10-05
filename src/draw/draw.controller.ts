import {
  Body,
  Controller,
  Param,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { DrawService } from './draw.service';
import { AdminJwtGuard } from '../common/guards/admin-jwt.guard';
import { AuditInterceptor } from '../common/interceptors/audit.interceptor';
import { CurrentAdmin } from '../common/decorators/current-user.decorator';

@ApiTags('admin-draw')
@ApiBearerAuth()
@UseGuards(AdminJwtGuard)
@UseInterceptors(AuditInterceptor)
@Controller('admin/lotteries/:id/draw')
export class DrawAdminController {
  constructor(private readonly draw: DrawService) {}

  @Post('commit')
  commit(@Param('id') id: string, @CurrentAdmin() admin: { id: string }) {
    return this.draw.commit(id, admin.id);
  }

  @Post('reveal')
  reveal(@Param('id') id: string, @CurrentAdmin() admin: { id: string }) {
    return this.draw.reveal(id, admin.id);
  }
}
