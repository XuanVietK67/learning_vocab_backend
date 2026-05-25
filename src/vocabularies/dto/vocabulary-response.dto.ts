import { Expose, Type } from 'class-transformer';
import { ProficiencyLevel } from '@/users/entities/proficiency-level.enum';
import { PartOfSpeech } from '@/vocabularies/entities/part-of-speech.enum';
import { VocabularySource } from '@/vocabularies/entities/vocabulary-source.enum';

export class VocabularyTranslationResponseDto {
  @Expose() id!: string;
  @Expose() language!: string;
  @Expose() translation!: string;
  @Expose() note!: string | null;
}

export class VocabularyExampleResponseDto {
  @Expose() id!: string;
  @Expose() sentence!: string;
  @Expose() translation!: string | null;
  @Expose() source!: string | null;
}

export class VocabularyResponseDto {
  @Expose() id!: string;
  @Expose() language!: string;
  @Expose() lemma!: string;
  @Expose() partOfSpeech!: PartOfSpeech;
  @Expose() ipa!: string | null;
  @Expose() cefrLevel!: ProficiencyLevel | null;
  @Expose() frequencyRank!: number | null;
  @Expose() audioUrl!: string | null;
  @Expose() imageUrl!: string | null;
  @Expose() source!: VocabularySource;

  @Expose()
  @Type(() => VocabularyTranslationResponseDto)
  translations?: VocabularyTranslationResponseDto[];

  @Expose()
  @Type(() => VocabularyExampleResponseDto)
  examples?: VocabularyExampleResponseDto[];
}

export class PaginatedVocabulariesResponseDto {
  @Expose()
  @Type(() => VocabularyResponseDto)
  data!: VocabularyResponseDto[];

  @Expose() page!: number;
  @Expose() limit!: number;
  @Expose() total!: number;
}
