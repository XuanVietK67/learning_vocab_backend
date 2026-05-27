import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { LearnSessionMode } from '@/learn/enums/learn-session-mode.enum';

const LANGUAGE_CODE_REGEX = /^[a-z]{2}(-[A-Z]{2})?$/;
const TOPIC_SLUG_REGEX = /^[a-z0-9-]+$/;

export class CreateSessionDto {
  @IsEnum(LearnSessionMode, {
    message: `mode must be one of ${Object.values(LearnSessionMode).join(', ')}`,
  })
  mode!: LearnSessionMode;

  // Required when mode=topic; rejected otherwise.
  @ValidateIf((o: CreateSessionDto) => o.mode === LearnSessionMode.TOPIC)
  @IsString()
  @Length(2, 64)
  @Matches(TOPIC_SLUG_REGEX, {
    message: 'topicSlug must match [a-z0-9-]+',
  })
  topicSlug?: string;

  // Required when mode=deck; rejected otherwise.
  @ValidateIf((o: CreateSessionDto) => o.mode === LearnSessionMode.DECK)
  @IsUUID('4')
  deckId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @IsOptional()
  @IsString()
  @Length(2, 8)
  @Matches(LANGUAGE_CODE_REGEX, {
    message: 'translationLang must be an ISO 639-1 code (e.g. "en", "vi")',
  })
  translationLang?: string;
}
