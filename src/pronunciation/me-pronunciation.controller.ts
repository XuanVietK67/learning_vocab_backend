import {
  Body,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ThrottlerGuard } from '@nestjs/throttler';
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '@/auth/strategies/jwt.strategy';
import { PronunciationResultDto } from '@/pronunciation/dto/pronunciation-result.dto';
import { SubmitPronunciationDto } from '@/pronunciation/dto/submit-pronunciation.dto';
import { PronunciationService } from '@/pronunciation/pronunciation.service';

// Upper bound on the raw upload before transcoding. Static (decorator-time), so
// it reads the env var directly; mirrors PRONUNCIATION_MAX_UPLOAD_BYTES used by
// the service config. Default 5 MB.
const MAX_UPLOAD_BYTES = parseInt(
  process.env.PRONUNCIATION_MAX_UPLOAD_BYTES ?? '5242880',
  10,
);

@Controller({ path: 'me/pronunciation', version: '1' })
@UseGuards(JwtAuthGuard)
export class MePronunciationController {
  constructor(private readonly pronunciationService: PronunciationService) {}

  @Post('attempts')
  @UseGuards(ThrottlerGuard)
  @UseInterceptors(
    FileInterceptor('audio', { limits: { fileSize: MAX_UPLOAD_BYTES } }),
  )
  submit(
    @CurrentUser() current: AuthenticatedUser,
    @UploadedFile() audio: Express.Multer.File | undefined,
    @Body() dto: SubmitPronunciationDto,
  ): Promise<PronunciationResultDto> {
    return this.pronunciationService.score(current.id, audio, dto);
  }
}
