import {
  Body,
  Controller,
  FileTypeValidator,
  Get,
  MaxFileSizeValidator,
  ParseFilePipe,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '@/auth/strategies/jwt.strategy';
import { AttemptsQueryDto } from '@/pronunciation/dto/attempts-query.dto';
import {
  PaginatedAttemptsResponseDto,
  ScoreAttemptResponseDto,
} from '@/pronunciation/dto/pronunciation-response.dto';
import { ScorePronunciationDto } from '@/pronunciation/dto/score-pronunciation.dto';
import { PronunciationService } from '@/pronunciation/pronunciation.service';

// The deployed scoring service decodes via ffmpeg, so browser MediaRecorder
// output (webm/opus, mp4/m4a) and mp3 upload directly — no client-side
// transcode needed. The optional `;codecs=...` suffix some browsers append is
// allowed. libsndfile-era formats (WAV/FLAC/OGG) still work.
const ACCEPTED_AUDIO =
  /^audio\/(wav|x-wav|wave|vnd\.wave|flac|x-flac|ogg|webm|mp4|x-m4a|m4a|aac|mpeg|mp3)(;.*)?$/;
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

@Controller({ path: 'pronunciation', version: '1' })
@UseGuards(JwtAuthGuard)
export class PronunciationController {
  constructor(private readonly service: PronunciationService) {}

  @Post('score')
  @UseInterceptors(FileInterceptor('audio'))
  score(
    @CurrentUser() current: AuthenticatedUser,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: MAX_AUDIO_BYTES }),
          new FileTypeValidator({ fileType: ACCEPTED_AUDIO }),
        ],
      }),
    )
    file: Express.Multer.File,
    @Body() dto: ScorePronunciationDto,
  ): Promise<ScoreAttemptResponseDto> {
    return this.service.score(current.id, dto, file);
  }

  @Get('attempts')
  findAttempts(
    @CurrentUser() current: AuthenticatedUser,
    @Query() query: AttemptsQueryDto,
  ): Promise<PaginatedAttemptsResponseDto> {
    return this.service.findAttempts(current.id, query);
  }
}
