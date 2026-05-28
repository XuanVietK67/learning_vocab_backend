import { PartialType } from '@nestjs/mapped-types';
import { IsOptional, IsString, Length } from 'class-validator';

export class CreateAdminExampleDto {
  @IsString()
  @Length(1, 1000)
  sentence!: string;

  @IsOptional()
  @IsString()
  @Length(1, 1000)
  translation?: string;

  @IsOptional()
  @IsString()
  @Length(1, 32)
  source?: string;
}

export class UpdateAdminExampleDto extends PartialType(CreateAdminExampleDto) {}
