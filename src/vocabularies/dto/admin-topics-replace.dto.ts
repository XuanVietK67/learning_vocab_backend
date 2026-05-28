import { ArrayMaxSize, IsArray, IsString, Matches } from 'class-validator';

const TOPIC_SLUG_REGEX = /^[a-z0-9-]+$/;

export class AdminTopicsReplaceDto {
  @IsArray()
  @ArrayMaxSize(32)
  @IsString({ each: true })
  @Matches(TOPIC_SLUG_REGEX, {
    each: true,
    message: 'topic slug must match [a-z0-9-]+',
  })
  slugs!: string[];
}
