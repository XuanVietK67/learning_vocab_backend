import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';

export class DeckMembershipDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('4', { each: true })
  vocabularyIds!: string[];
}

export class DeckMembershipSummaryDto {
  added!: number;
  alreadyMember!: number;
  // Vocab IDs that exist but aren't accessible (other users' private words),
  // or that don't exist at all. Surfaced so clients can flag stale UI state.
  inaccessibleVocabularyIds!: string[];
  vocabCount!: number;
}
