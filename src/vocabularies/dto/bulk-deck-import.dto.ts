import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

const LANGUAGE_CODE_REGEX = /^[a-z]{2}(-[A-Z]{2})?$/;

/**
 * Bulk-import a list of lemmas into one of the caller's decks. Each lemma is
 * enriched into the caller's own word(s) and appended to the target deck. Like
 * the admin bulk quick-create but without topics (a system-catalog concept).
 */
export class BulkDeckImportDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @Length(1, 128, { each: true })
  lemmas!: string[];

  @IsOptional()
  @IsString()
  @Length(2, 8)
  @Matches(LANGUAGE_CODE_REGEX, {
    message: 'language must be an ISO 639-1 code (e.g. "en", "vi", "pt-BR")',
  })
  language?: string;

  // Target language for the per-sense translation the worker asks Gemma to
  // produce on every lemma. Omitted → configured default; equal to `language`
  // → translation is skipped.
  @IsOptional()
  @IsString()
  @Length(2, 8)
  @Matches(LANGUAGE_CODE_REGEX, {
    message:
      'translationLanguage must be an ISO 639-1 code (e.g. "en", "vi", "pt-BR")',
  })
  translationLanguage?: string;
}
