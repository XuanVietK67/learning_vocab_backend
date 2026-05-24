import { IsString, MinLength } from 'class-validator';

export class GithubSignInDto {
  @IsString()
  @MinLength(8)
  code!: string;
}
