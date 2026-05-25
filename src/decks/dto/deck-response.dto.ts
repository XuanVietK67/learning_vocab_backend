import { Expose, Type } from 'class-transformer';
import { ProficiencyLevel } from '@/users/entities/proficiency-level.enum';
import { VocabularyResponseDto } from '@/vocabularies/dto/vocabulary-response.dto';

export class DeckSummaryResponseDto {
  @Expose() id!: string;
  @Expose() name!: string;
  @Expose() description!: string | null;
  @Expose() language!: string;
  @Expose() cefrLevel!: ProficiencyLevel | null;
  @Expose() vocabCount!: number;
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
