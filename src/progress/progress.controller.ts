import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '@/auth/strategies/jwt.strategy';
import { DueQueryDto } from '@/progress/dto/due-query.dto';
import { EnrollDto, EnrollResponseDto } from '@/progress/dto/enroll.dto';
import {
  DueCardResponseDto,
  ProgressResponseDto,
} from '@/progress/dto/progress-response.dto';
import { ReviewDto } from '@/progress/dto/review.dto';
import { StatsResponseDto } from '@/progress/dto/stats-response.dto';
import { ProgressService } from '@/progress/progress.service';

@Controller({ path: 'me/progress', version: '1' })
@UseGuards(JwtAuthGuard)
export class MeProgressController {
  constructor(private readonly progressService: ProgressService) {}

  @Post('enroll')
  @HttpCode(HttpStatus.OK)
  enroll(
    @CurrentUser() current: AuthenticatedUser,
    @Body() dto: EnrollDto,
  ): Promise<EnrollResponseDto> {
    return this.progressService.enroll(current.id, dto);
  }

  @Get('due')
  due(
    @CurrentUser() current: AuthenticatedUser,
    @Query() query: DueQueryDto,
  ): Promise<DueCardResponseDto[]> {
    return this.progressService.findDue(current.id, query);
  }

  @Post('review')
  @HttpCode(HttpStatus.OK)
  review(
    @CurrentUser() current: AuthenticatedUser,
    @Body() dto: ReviewDto,
  ): Promise<ProgressResponseDto> {
    return this.progressService.submitReview(current.id, dto);
  }
}

@Controller({ path: 'me/stats', version: '1' })
@UseGuards(JwtAuthGuard)
export class MeStatsController {
  constructor(private readonly progressService: ProgressService) {}

  @Get()
  stats(@CurrentUser() current: AuthenticatedUser): Promise<StatsResponseDto> {
    return this.progressService.getStats(current.id);
  }
}
