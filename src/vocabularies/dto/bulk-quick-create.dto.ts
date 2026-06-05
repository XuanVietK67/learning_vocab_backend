import { Expose } from 'class-transformer';
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
 * The confirmed list of lemmas to enrich (phase 2 of bulk quick-create). One
 * enrichment job is created per lemma, grouped under a shared batch id.
 */
export class BulkQuickCreateDto {
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
}

export class BulkQuickCreateResponseDto {
  // Null when nothing was accepted (every lemma was skipped). Otherwise the id
  // to poll batch progress with.
  @Expose() batchId!: string | null;
  @Expose() accepted!: number;
  @Expose() skipped!: number;
}
