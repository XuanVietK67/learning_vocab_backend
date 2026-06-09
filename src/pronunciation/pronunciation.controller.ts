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

// libsndfile (the scoring service decoder) handles WAV/FLAC/OGG; browser
// webm/opus must be transcoded to one of these before upload (v1 limitation).
const ACCEPTED_AUDIO = /^audio\/(wav|x-wav|wave|vnd\.wave|flac|x-flac|ogg)$/;
const MAX_AUDIO_BYTES = 5 * 1024 * 1024;

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
