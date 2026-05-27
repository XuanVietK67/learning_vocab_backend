import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { CreateVocabularyDto } from '@/vocabularies/dto/create-vocabulary.dto';

export class BulkImportVocabulariesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => CreateVocabularyDto)
  items!: CreateVocabularyDto[];
}

export class BulkImportSummaryDto {
  upserted!: number;
  inserted!: number;
  updated!: number;
  sensesAdded!: number;
  translationsAdded!: number;
  examplesAdded!: number;
  topicLinksAdded!: number;
}
