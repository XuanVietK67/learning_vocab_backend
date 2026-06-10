import { IsOptional, IsString, Matches } from 'class-validator';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export class ActivityQueryDto {
  @IsOptional()
  @IsString()
  @Matches(DATE_REGEX, { message: 'from must be a date in YYYY-MM-DD format' })
  from?: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_REGEX, { message: 'to must be a date in YYYY-MM-DD format' })
  to?: string;

  // Validated against the IANA database in the service (Intl), not here.
  @IsOptional()
  @IsString()
  tz?: string;
}
