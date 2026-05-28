import { PartialType } from '@nestjs/mapped-types';
import { IsOptional, IsString, Length, Matches } from 'class-validator';

const LANGUAGE_CODE_REGEX = /^[a-z]{2}(-[A-Z]{2})?$/;

export class CreateAdminTranslationDto {
  @IsString()
  @Length(2, 8)
  @Matches(LANGUAGE_CODE_REGEX, {
    message: 'language must be an ISO 639-1 code (e.g. "en", "vi", "pt-BR")',
  })
  language!: string;

  @IsString()
  @Length(1, 255)
  translation!: string;

  @IsOptional()
  @IsString()
  @Length(1, 2000)
  note?: string;
}

export class UpdateAdminTranslationDto extends PartialType(
  CreateAdminTranslationDto,
) {}
