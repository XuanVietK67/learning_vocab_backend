import { IsOptional, IsString, Length, Matches } from 'class-validator';

const LANGUAGE_CODE_REGEX = /^[a-z]{2}(-[A-Z]{2})?$/;

/**
 * Quick-create input: just the word. The enrichment worker fills part(s) of
 * speech, ipa, definitions, examples, CEFR, etc. `language` defaults to English
 * when omitted.
 */
export class QuickCreateVocabularyDto {
  @IsString()
  @Length(1, 128)
  lemma!: string;

  @IsOptional()
  @IsString()
  @Length(2, 8)
  @Matches(LANGUAGE_CODE_REGEX, {
    message: 'language must be an ISO 639-1 code (e.g. "en", "vi", "pt-BR")',
  })
  language?: string;
}
