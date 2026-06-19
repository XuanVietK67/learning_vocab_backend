import { PartOfSpeech } from '@/vocabularies/entities/part-of-speech.enum';

/**
 * One word served up ready to practise: enough for the client to render the
 * prompt (lemma + meaning) and play the reference audio before the user writes
 * or speaks a sentence. The same shape is returned by both the SRS-suggestions
 * and the explicit-set endpoints so the practice queue renders identically.
 */
export class PracticeItemDto {
  vocabularyId!: string;
  lemma!: string;
  partOfSpeech!: PartOfSpeech;
  ipa!: string | null;
  audioUrl!: string | null;
  // Up to 5 sense glosses (gloss, falling back to definition), most-salient
  // first — the meaning hint shown next to the word.
  glosses!: string[];
}

/** Response for GET /v1/me/practice/suggestions. */
export class PracticeSuggestionsResponseDto {
  items!: PracticeItemDto[];
  // true when the SRS picker ran short of due / level-appropriate fresh words
  // and the list was topped up with random words so practice is never empty.
  usedFallback!: boolean;
}

/** Response for POST /v1/me/practice/sets. */
export class PracticeSetResponseDto {
  items!: PracticeItemDto[];
  // Requested IDs that don't exist or aren't practiceable (another user's
  // private word, or an unapproved system draft). Surfaced so the client can
  // flag stale UI state. Mirrors the deck-membership response.
  inaccessibleVocabularyIds!: string[];
}
