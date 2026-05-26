import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateDeckDto } from '@/decks/dto/create-deck.dto';

// Membership has its own endpoints; patching the deck only touches metadata.
export class UpdateDeckDto extends PartialType(
  OmitType(CreateDeckDto, ['vocabularyIds'] as const),
) {}
