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
const TOPIC_SLUG_REGEX = /^[a-z0-9-]+$/;

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

  // Topic slugs to attach to every word this submission touches: each created
  // draft is linked, and any lemma that already exists as a system word is
  // tagged in place (tag-on-skip). Slugs must already exist in the catalog.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(32)
  @IsString({ each: true })
  @Length(1, 64, { each: true })
  @Matches(TOPIC_SLUG_REGEX, {
    each: true,
    message: 'topic slug must match [a-z0-9-]+',
  })
  topics?: string[];
}

export class BulkQuickCreateResponseDto {
  // Null when nothing was accepted (every lemma was skipped). Otherwise the id
  // to poll batch progress with.
  @Expose() batchId!: string | null;
  @Expose() accepted!: number;
  @Expose() skipped!: number;
}
