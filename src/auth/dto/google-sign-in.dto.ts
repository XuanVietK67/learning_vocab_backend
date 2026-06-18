import { IsString, MinLength, ValidateIf } from 'class-validator';

export class GoogleSignInDto {
  // Authorization-code flow (current): the GIS popup `code`. Validated unless a
  // legacy `idToken` is sent instead.
  @ValidateIf((o: GoogleSignInDto) => o.idToken === undefined)
  @IsString()
  @MinLength(8)
  code?: string;

  // Legacy GIS credential flow: the Google ID token. Accepted for backward
  // compatibility during rollout; will be dropped once the frontend is fully on `code`.
  @ValidateIf((o: GoogleSignInDto) => o.code === undefined)
  @IsString()
  @MinLength(20)
  idToken?: string;
}
