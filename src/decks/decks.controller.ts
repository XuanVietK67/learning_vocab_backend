import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '@/auth/strategies/jwt.strategy';
import { DecksService } from '@/decks/decks.service';
import { CreateDeckDto } from '@/decks/dto/create-deck.dto';
import { DeckDetailQueryDto, DeckQueryDto } from '@/decks/dto/deck-query.dto';
import {
  DeckMembershipDto,
  DeckMembershipSummaryDto,
} from '@/decks/dto/deck-membership.dto';
import {
  DeckDetailResponseDto,
  DeckSummaryResponseDto,
  PaginatedDecksResponseDto,
} from '@/decks/dto/deck-response.dto';
import { MyDecksQueryDto } from '@/decks/dto/my-decks-query.dto';
import { UpdateDeckDto } from '@/decks/dto/update-deck.dto';

@Controller({ path: 'decks', version: '1' })
export class DecksController {
  constructor(private readonly decksService: DecksService) {}

  @Get()
  findAll(@Query() query: DeckQueryDto): Promise<PaginatedDecksResponseDto> {
    return this.decksService.findAll(query);
  }

  // Community catalog of user decks published as `public`. Declared before `:id`
  // so the literal path is matched first.
  @Get('public')
  findPublic(@Query() query: DeckQueryDto): Promise<PaginatedDecksResponseDto> {
    return this.decksService.findPublic(query);
  }

  @Get(':id')
  findOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query() query: DeckDetailQueryDto,
  ): Promise<DeckDetailResponseDto> {
    return this.decksService.findById(id, query.translationLang);
  }
}

// Specific (literal) paths are declared before `:id` so Nest's router resolves
// them first — `suggested` and the empty-string collection routes must not
// fall through to `:id`.
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

  @Get()
  findMine(
    @CurrentUser() current: AuthenticatedUser,
    @Query() query: MyDecksQueryDto,
  ): Promise<PaginatedDecksResponseDto> {
    return this.decksService.findMyDecks(current.id, query);
  }

  @Post()
  create(
    @CurrentUser() current: AuthenticatedUser,
    @Body() dto: CreateDeckDto,
  ): Promise<DeckDetailResponseDto> {
    return this.decksService.createUserDeck(current.id, dto);
  }

  // Save a copy of a seeded or published-`public` deck into my own decks.
  @Post(':id/clone')
  @HttpCode(HttpStatus.CREATED)
  clone(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<DeckDetailResponseDto> {
    return this.decksService.cloneDeck(current.id, id);
  }

  @Get(':id')
  findOne(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query() query: DeckDetailQueryDto,
  ): Promise<DeckDetailResponseDto> {
    return this.decksService.findMyDeckById(
      current.id,
      id,
      query.translationLang,
    );
  }

  @Patch(':id')
  update(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateDeckDto,
  ): Promise<DeckDetailResponseDto> {
    return this.decksService.updateUserDeck(current.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<void> {
    return this.decksService.deleteUserDeck(current.id, id);
  }

  @Post(':id/vocabularies')
  @HttpCode(HttpStatus.OK)
  addVocabularies(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: DeckMembershipDto,
  ): Promise<DeckMembershipSummaryDto> {
    return this.decksService.addVocabulariesToUserDeck(current.id, id, dto);
  }

  @Delete(':id/vocabularies/:vocabularyId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeVocabulary(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('vocabularyId', new ParseUUIDPipe({ version: '4' }))
    vocabularyId: string,
  ): Promise<void> {
    return this.decksService.removeVocabularyFromUserDeck(
      current.id,
      id,
      vocabularyId,
    );
  }
}
