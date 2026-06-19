import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '@/auth/strategies/jwt.strategy';
import {
  AttemptAcceptedDto,
  AttemptResultDto,
} from '@/practice/dto/attempt-response.dto';
import {
  PracticeSetResponseDto,
  PracticeSuggestionsResponseDto,
} from '@/practice/dto/practice-item.dto';
import { PracticeSetDto } from '@/practice/dto/practice-set.dto';
import { PracticeSuggestionsQueryDto } from '@/practice/dto/practice-suggestions-query.dto';
import { SubmitAttemptDto } from '@/practice/dto/submit-attempt.dto';
import { PracticeService } from '@/practice/practice.service';

@Controller({ path: 'me/practice', version: '1' })
@UseGuards(JwtAuthGuard)
export class PracticeController {
  constructor(private readonly practiceService: PracticeService) {}

  // Build a ready-to-practise word list (SRS-picked due/fresh words, topped up
  // with random level-matched words) so the user doesn't have to search.
  @Get('suggestions')
  getSuggestions(
    @CurrentUser() current: AuthenticatedUser,
    @Query() query: PracticeSuggestionsQueryDto,
  ): Promise<PracticeSuggestionsResponseDto> {
    return this.practiceService.getSuggestions(current.id, query);
  }

  // Validate + hydrate an explicit list of words the user ticked from a list.
  // 200 (a lookup, not a resource creation).
  @Post('sets')
  @HttpCode(HttpStatus.OK)
  buildSet(
    @CurrentUser() current: AuthenticatedUser,
    @Body() dto: PracticeSetDto,
  ): Promise<PracticeSetResponseDto> {
    return this.practiceService.buildSet(current.id, dto);
  }

  // Submit a sentence for the target word. Returns 202 — scoring is async;
  // poll GET /attempts/:id for the rubric.
  @Post('attempts')
  @HttpCode(HttpStatus.ACCEPTED)
  submit(
    @CurrentUser() current: AuthenticatedUser,
    @Body() dto: SubmitAttemptDto,
  ): Promise<AttemptAcceptedDto> {
    return this.practiceService.submit(current.id, dto);
  }

  @Get('attempts/:id')
  getResult(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<AttemptResultDto> {
    return this.practiceService.getResult(current.id, id);
  }
}
