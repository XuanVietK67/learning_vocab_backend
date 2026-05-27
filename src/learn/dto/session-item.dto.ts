import { QuestionType } from '@/learn/enums/question-type.enum';

// Discriminated union by `type`. The frontend should switch on `type`
// and render the matching prompt shape. All payloads share the envelope
// fields (vocabularyId, exampleId, nonce, issuedAtMs, signature) so the
// /answer endpoint can verify provenance regardless of question type.

export interface SessionItemEnvelope {
  sessionItemId: string;
  vocabularyId: string;
  lemma: string;
  exampleId: string;
  type: QuestionType;
  nonce: string;
  issuedAtMs: number;
  signature: string;
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
  items: SessionItemDto[];
}
