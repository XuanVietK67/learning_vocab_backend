import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '@/auth/strategies/jwt.strategy';
import {
  AttemptAcceptedDto,
  AttemptResultDto,
} from '@/practice/dto/attempt-response.dto';
import { SubmitAttemptDto } from '@/practice/dto/submit-attempt.dto';
import { PracticeService } from '@/practice/practice.service';

@Controller({ path: 'me/practice', version: '1' })
@UseGuards(JwtAuthGuard)
export class PracticeController {
  constructor(private readonly practiceService: PracticeService) {}

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
