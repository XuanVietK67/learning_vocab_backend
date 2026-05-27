import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateVocabularyDto } from '@/vocabularies/dto/create-vocabulary.dto';

// Top-level updates only. Senses, translations, examples, and topic links have
// their own dedicated mutation paths (or use DELETE + POST for now); attempting
// to patch them via this endpoint would have ambiguous merge semantics.
export class UpdateVocabularyDto extends PartialType(
  OmitType(CreateVocabularyDto, ['senses', 'topics'] as const),
) {}
