import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { SUPPORTED_LOCALES } from '@/pronunciation/speech/locale';

// Multipart body accompanying the uploaded `audio` file. The audio itself is
// handled by the file interceptor, not validated here.
export class SubmitPronunciationDto {
  @IsString()
  @Length(1, 256)
  referenceText!: string;

  @IsOptional()
  @IsString()
  @IsIn(SUPPORTED_LOCALES, {
    message: `locale must be one of ${SUPPORTED_LOCALES.join(', ')}`,
  })
  locale?: string;
}
