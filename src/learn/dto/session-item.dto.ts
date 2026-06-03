import { LearnSessionMode } from '@/learn/enums/learn-session-mode.enum';
import { QuestionType } from '@/learn/enums/question-type.enum';

export type SessionEmptyReason =
  | 'no_due_cards'
  | 'no_more_at_level'
  | 'no_enrollment'
  | 'deck_exhausted';

// Discriminated union by `type`. The frontend should switch on `type`
// and render the matching prompt shape. All payloads share the envelope
// fields (vocabularyId, exampleId, nonce, issuedAtMs, signature) so the
// /answer endpoint can verify provenance regardless of question type.

export interface SessionItemEnvelope {
  sessionItemId: string;
  // A word's lesson is a ladder of questions (easy→hard). Every step of the
  // same word shares `groupId`; `stepIndex`/`stepCount` place it within the
  // ladder. Only the final step (stepIndex === stepCount - 1) updates the
  // SRS schedule — earlier steps grade for feedback only.
  groupId: string;
  stepIndex: number;
  stepCount: number;
  vocabularyId: string;
  lemma: string;
  exampleId: string;
  type: QuestionType;
  nonce: string;
  issuedAtMs: number;
  signature: string;
}

// One sense as rendered on a flashcard reveal.
export interface FlashcardSenseView {
  gloss: string | null;
  definition: string | null;
  // Translation in the session's translationLang, when available.
  translation: string | null;
  example: { sentence: string; translation: string | null } | null;
  synonyms: string[];
  antonyms: string[];
}

// Self-rated study card. Front shows the lemma; the reveal shows the senses
// (meaning + example), pronunciation, and audio. The user submits a
// self-rating as `userAnswer` (see the grader for accepted values).
export interface FlashcardPrompt {
  type: QuestionType.FLASHCARD;
  lemma: string;
  ipa: string | null;
  partOfSpeech: string;
  audioUrl: string | null;
  senses: FlashcardSenseView[];
}

export interface ClozeMcqPrompt {
  type: QuestionType.CLOZE_MCQ;
  sentenceWithBlank: string;
  hintTranslation: string | null;
  audioUrl: string | null;
  options: string[];
}

export interface ClozeTypingPrompt {
  type: QuestionType.CLOZE_TYPING;
  sentenceWithBlank: string;
  hintTranslation: string | null;
  audioUrl: string | null;
}

export interface MeaningInContextPrompt {
  type: QuestionType.MEANING_IN_CONTEXT;
  sentence: string;
  highlightedSpan: { start: number; end: number };
  options: string[]; // translation candidates in target language
}

export interface SentenceBuildPrompt {
  type: QuestionType.SENTENCE_BUILD;
  translation: string;
  tokens: string[]; // shuffled
}

export interface SenseDisambiguationPair {
  exampleId: string;
  sentence: string;
}

export interface SenseDisambiguationPrompt {
  type: QuestionType.SENSE_DISAMBIGUATION;
  sentences: SenseDisambiguationPair[]; // two example sentences
  options: string[]; // two translations, one per sense
}

export interface ListeningClozePrompt {
  type: QuestionType.LISTENING_CLOZE;
  audioUrl: string;
  sentenceWithBlank: string;
  hintTranslation: string | null;
  options: string[]; // 4-option MCQ form for v1
}

export type SessionItemPrompt =
  | FlashcardPrompt
  | ClozeMcqPrompt
  | ClozeTypingPrompt
  | MeaningInContextPrompt
  | SentenceBuildPrompt
  | SenseDisambiguationPrompt
  | ListeningClozePrompt;

export interface SessionItemDto extends SessionItemEnvelope {
  prompt: SessionItemPrompt;
}

export interface CreateSessionResponseDto {
  sessionId: string;
  mode: LearnSessionMode;
  // Number of words newly enrolled into the user's progress as a side effect
  // of this call. Always 0 for mode=review.
  enrolledNewlyCount: number;
  // Non-null only when items is empty — tells the frontend which empty-state
  // screen to show. Null when items.length > 0.
  emptyReason: SessionEmptyReason | null;
  // ISO timestamp of the soonest progress row scheduled in the future.
  // Populated only when items is empty and emptyReason='no_due_cards' so the
  // empty-state screen can render "come back at X". Null in every other case.
  nextDueAt: string | null;
  items: SessionItemDto[];
}
