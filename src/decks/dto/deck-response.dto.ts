import { Expose, Type } from 'class-transformer';
import { ProficiencyLevel } from '@/users/entities/proficiency-level.enum';
import { Visibility } from '@/vocabularies/entities/visibility.enum';
import { VocabularyResponseDto } from '@/vocabularies/dto/vocabulary-response.dto';

export class DeckSummaryResponseDto {
  @Expose() id!: string;
  @Expose() name!: string;
  @Expose() description!: string | null;
  @Expose() language!: string;
  @Expose() cefrLevel!: ProficiencyLevel | null;
  @Expose() vocabCount!: number;
  // `system` = seeded global deck (ownerId null); `public`/`private` = a user
  // deck. Lets the client tell community decks apart from the catalog.
  @Expose() visibility!: Visibility;
  // Null for system decks; the author's user id for user-owned decks.
  @Expose() ownerId!: string | null;
}

export class DeckDetailResponseDto extends DeckSummaryResponseDto {
  @Expose()
  @Type(() => VocabularyResponseDto)
  vocabularies!: VocabularyResponseDto[];
}

export class PaginatedDecksResponseDto {
  @Expose()
  @Type(() => DeckSummaryResponseDto)
  data!: DeckSummaryResponseDto[];

  @Expose() page!: number;
  @Expose() limit!: number;
  @Expose() total!: number;
}
