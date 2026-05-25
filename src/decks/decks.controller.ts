import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '@/auth/strategies/jwt.strategy';
import { DecksService } from '@/decks/decks.service';
import { DeckDetailQueryDto, DeckQueryDto } from '@/decks/dto/deck-query.dto';
import {
  DeckDetailResponseDto,
  DeckSummaryResponseDto,
  PaginatedDecksResponseDto,
} from '@/decks/dto/deck-response.dto';

@Controller({ path: 'decks', version: '1' })
export class DecksController {
  constructor(private readonly decksService: DecksService) {}

  @Get()
  findAll(@Query() query: DeckQueryDto): Promise<PaginatedDecksResponseDto> {
    return this.decksService.findAll(query);
  }

  @Get(':id')
  findOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query() query: DeckDetailQueryDto,
  ): Promise<DeckDetailResponseDto> {
    return this.decksService.findById(id, query.translationLang);
  }
}

@Controller({ path: 'me/decks', version: '1' })
@UseGuards(JwtAuthGuard)
export class MeDecksController {
  constructor(private readonly decksService: DecksService) {}

  @Get('suggested')
  suggested(
    @CurrentUser() current: AuthenticatedUser,
  ): Promise<DeckSummaryResponseDto[]> {
    return this.decksService.findSuggestedForUser(current.id);
  }
}
