import { Expose, Type } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

const LANGUAGE_CODE_REGEX = /^[a-z]{2}(-[A-Z]{2})?$/;

export type ExtractMode = 'list' | 'prose';

/**
 * Form fields for the extract step. Sent as multipart alongside an optional
 * `file`. When no file is uploaded, `text` is parsed as a pasted word list (or
 * prose, per `mode`).
 */
export class ExtractLemmasDto {
  @IsOptional()
  @IsString()
  @MaxLength(1_000_000)
  text?: string;

  @IsOptional()
  @IsIn(['list', 'prose'], { message: 'mode must be "list" or "prose"' })
  mode?: ExtractMode;

  @IsOptional()
  @IsString()
  @Length(2, 8)
  @Matches(LANGUAGE_CODE_REGEX, {
    message: 'language must be an ISO 639-1 code (e.g. "en", "vi", "pt-BR")',
  })
  language?: string;
}

export class ExtractStatsDto {
  @Expose() extracted!: number;
  @Expose() deduped!: number;
  @Expose() removedStopwords!: number;
  @Expose() alreadyInCatalog!: number;
  @Expose() capped!: boolean;
}

export class ExtractLemmasResponseDto {
  @Expose() lemmas!: string[];

  @Expose()
  @Type(() => ExtractStatsDto)
  stats!: ExtractStatsDto;
}
