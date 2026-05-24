import { IsOptional, IsString, MinLength } from 'class-validator';

export class AppleSignInDto {
  @IsString()
  @MinLength(20)
  idToken!: string;

  @IsOptional()
  @IsString()
  fullName?: string;
}
