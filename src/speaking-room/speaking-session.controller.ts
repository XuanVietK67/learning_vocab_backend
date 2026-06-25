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
  PaginatedScenarioCardsDto,
  ScenarioCardDto,
} from '@/speaking-room/dto/scenario-card.dto';
import { ScenarioBrowseQueryDto } from '@/speaking-room/dto/scenario-browse-query.dto';
import {
  SessionReportResponseDto,
  SessionStartedDto,
  TurnResultDto,
} from '@/speaking-room/dto/session-response.dto';
import { StartSessionDto } from '@/speaking-room/dto/start-session.dto';
import { TakeTurnDto } from '@/speaking-room/dto/take-turn.dto';
import { SpeakingSessionService } from '@/speaking-room/speaking-session.service';

// Learner-facing Phase 2 surface: browse published scenarios and run a live,
// turn-based practice session. Admin authoring lives in AdminScenariosController.
@Controller({ path: 'speaking', version: '1' })
@UseGuards(JwtAuthGuard)
export class SpeakingSessionController {
  constructor(private readonly sessions: SpeakingSessionService) {}

  // Browse/recommend the published scenario catalogue.
  @Get('scenarios')
  browseScenarios(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ScenarioBrowseQueryDto,
  ): Promise<PaginatedScenarioCardsDto> {
    return this.sessions.browseScenarios(user.id, query);
  }

  @Get('scenarios/:id')
  getScenario(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<ScenarioCardDto> {
    return this.sessions.getScenarioCard(id);
  }

  // Start a session: pick a scenario (+ optional target words) -> session handle
  // + the AI opening line.
  @Post('sessions')
  start(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: StartSessionDto,
  ): Promise<SessionStartedDto> {
    return this.sessions.start(user.id, dto);
  }

  // One user turn -> the AI reply (to speak) + corrections (to show).
  @Post('sessions/:id/turn')
  @HttpCode(HttpStatus.OK)
  takeTurn(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: TakeTurnDto,
  ): Promise<TurnResultDto> {
    return this.sessions.takeTurn(user.id, id, dto);
  }

  // End the session -> generate (or return) the feedback report.
  @Post('sessions/:id/end')
  @HttpCode(HttpStatus.OK)
  end(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<SessionReportResponseDto> {
    return this.sessions.end(user.id, id);
  }

  @Get('sessions/:id/report')
  getReport(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<SessionReportResponseDto> {
    return this.sessions.getReport(user.id, id);
  }
}
