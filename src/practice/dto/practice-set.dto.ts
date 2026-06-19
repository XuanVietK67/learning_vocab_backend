import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';

export class PracticeSetDto {
  // The words the user ticked to practise. Validated/hydrated server-side;
  // ones that don't exist or aren't accessible come back under
  // `inaccessibleVocabularyIds`.
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  vocabularyIds!: string[];
}
