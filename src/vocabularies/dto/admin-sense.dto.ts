import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  Length,
  ValidateNested,
} from 'class-validator';
import { CreateAdminExampleDto } from '@/vocabularies/dto/admin-example.dto';
import { CreateAdminTranslationDto } from '@/vocabularies/dto/admin-translation.dto';

// Standalone sense create — unlike CreateSenseDto used by full-vocab create,
// we don't require a minimum of 2 examples here. Admin may add examples in
// follow-up calls; the learn layer already skips senses with <2 examples.
export class CreateAdminSenseDto {
  @IsOptional()
  @IsString()
  @Length(1, 128)
  gloss?: string;

  @IsOptional()
  @IsString()
  @Length(1, 2000)
  definition?: string;

  @IsOptional()
  @IsString()
  @Length(1, 512)
  imageUrl?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(16)
  @ValidateNested({ each: true })
  @Type(() => CreateAdminTranslationDto)
  translations?: CreateAdminTranslationDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(16)
  @ValidateNested({ each: true })
  @Type(() => CreateAdminExampleDto)
  examples?: CreateAdminExampleDto[];
}

export class UpdateAdminSenseDto {
  @IsOptional()
  @IsString()
  @Length(1, 128)
  gloss?: string;

  @IsOptional()
  @IsString()
  @Length(1, 2000)
  definition?: string;

  @IsOptional()
  @IsString()
  @Length(1, 512)
  imageUrl?: string;
}
