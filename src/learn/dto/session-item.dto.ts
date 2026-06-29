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
  // The example sentence's stored translation, revealed AFTER the user answers.
  // Distinct from the cloze `hintTranslation` (a pre-answer scaffold): this is a
  // post-answer gloss, and unlike the cloze field it never falls back to a sense
  // translation — null when the example has no translation of its own.
  sentenceTranslation: string | null;
}

// Show ONE example sentence and ask which meaning fits it. The distractors are
// the word's *other* senses' translations (polysemy traps), padded with
// sibling-word translations up to four options. `userAnswer` = the chosen
// meaning text. `highlightedSpan` marks the lemma occurrence when it could be
// located in the sentence (absent if not).
export interface SenseDisambiguationPrompt {
  type: QuestionType.SENSE_DISAMBIGUATION;
  sentence: string;
  highlightedSpan?: { start: number; end: number };
  options: string[]; // meaning candidates in the session's translationLang
  // The example sentence's stored translation, revealed AFTER the user answers.
  // Post-answer gloss (not a hint); null when the example has no translation.
  sentenceTranslation: string | null;
}

export interface ListeningClozePrompt {
  type: QuestionType.LISTENING_CLOZE;
  audioUrl: string;
  sentenceWithBlank: string;
  hintTranslation: string | null;
  options: string[]; // 4-option MCQ form for v1
}

// Show a translation, pick the matching lemma. `userAnswer` = the chosen lemma.
export interface WordFromTranslationPrompt {
  type: QuestionType.WORD_FROM_TRANSLATION;
  translation: string; // shown in the session's translationLang
  options: string[]; // lemma candidates
}

// Show the bare lemma, pick its translation. `userAnswer` = the chosen translation.
export interface TranslationFromWordPrompt {
  type: QuestionType.TRANSLATION_FROM_WORD;
  lemma: string;
  options: string[]; // translation candidates in the session's translationLang
}

// Play the word's audio, pick the matching lemma. `userAnswer` = the chosen lemma.
export interface ListeningChoicePrompt {
  type: QuestionType.LISTENING_CHOICE;
  audioUrl: string;
  options: string[]; // lemma candidates
}

// Play the word's audio, type the lemma. `userAnswer` = the typed word.
export interface DictationPrompt {
  type: QuestionType.DICTATION;
  audioUrl: string;
  hintTranslation: string | null; // optional scaffold, in translationLang
}

// Show a sense image, pick the matching lemma. `userAnswer` = the chosen lemma.
export interface ImageChoicePrompt {
  type: QuestionType.IMAGE_CHOICE;
  imageUrl: string;
  options: string[]; // lemma candidates
}

// Speak the word; the client runs speech-to-text and submits the transcript as
// `userAnswer`, compared (lenient) against the lemma. `audioUrl` is a reference
// pronunciation for the learner, when available.
export interface PronunciationPrompt {
  type: QuestionType.PRONUNCIATION;
  lemma: string;
  ipa: string | null;
  audioUrl: string | null;
}

export type SessionItemPrompt =
  | FlashcardPrompt
  | ClozeMcqPrompt
  | ClozeTypingPrompt
  | MeaningInContextPrompt
  | SenseDisambiguationPrompt
  | ListeningClozePrompt
  | WordFromTranslationPrompt
  | TranslationFromWordPrompt
  | ListeningChoicePrompt
  | DictationPrompt
  | ImageChoicePrompt
  | PronunciationPrompt;

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
