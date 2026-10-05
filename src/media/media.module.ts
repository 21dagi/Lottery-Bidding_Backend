import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MediaService } from './media.service';
import { MediaController } from './media.controller';

@Module({
  imports: [JwtModule.register({})],
  controllers: [MediaController],
  providers: [MediaService],
  exports: [MediaService],
})
export class MediaModule {}
