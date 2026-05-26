import { IsOptional, IsString, Length, Matches } from 'class-validator';

const TOPIC_SLUG_REGEX = /^[a-z0-9-]+$/;

export class CreateTopicDto {
  @IsString()
  @Length(2, 64)
  @Matches(TOPIC_SLUG_REGEX, {
    message: 'slug must contain only lowercase letters, digits, and hyphens',
  })
  slug!: string;

  @IsString()
  @Length(1, 128)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(1, 2000)
  description?: string;

  @IsOptional()
  @IsString()
  @Length(1, 512)
  iconUrl?: string;
}
