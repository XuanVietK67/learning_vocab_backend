import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsUUID,
  ValidateIf,
} from 'class-validator';

export class EnrollDto {
  @ValidateIf((o: EnrollDto) => !o.deckId)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('4', { each: true })
  vocabularyIds?: string[];

  @ValidateIf((o: EnrollDto) => !o.vocabularyIds)
  @IsOptional()
  @IsUUID('4')
  deckId?: string;
}

export class EnrollResponseDto {
  enrolled!: number;
  alreadyEnrolled!: number;
  unknownVocabularyIds!: string[];
}
