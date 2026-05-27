import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '@/auth/strategies/jwt.strategy';
import { AnswerResultDto } from '@/learn/dto/answer-result.dto';
import { CreateSessionDto } from '@/learn/dto/create-session.dto';
import { CreateSessionResponseDto } from '@/learn/dto/session-item.dto';
import { SubmitAnswerDto } from '@/learn/dto/submit-answer.dto';
import { LearnService } from '@/learn/learn.service';

@Controller({ path: 'me/learn', version: '1' })
@UseGuards(JwtAuthGuard)
export class LearnController {
  constructor(private readonly learnService: LearnService) {}

  @Post('session')
  @HttpCode(HttpStatus.OK)
  createSession(
    @CurrentUser() current: AuthenticatedUser,
    @Body() dto: CreateSessionDto,
  ): Promise<CreateSessionResponseDto> {
    return this.learnService.createSession(current.id, dto);
  }

  @Post('answer')
  @HttpCode(HttpStatus.OK)
  submitAnswer(
    @CurrentUser() current: AuthenticatedUser,
    @Body() dto: SubmitAnswerDto,
  ): Promise<AnswerResultDto> {
    return this.learnService.submitAnswer(current.id, dto);
  }
}
