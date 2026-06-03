import { ProgressStatus } from '@/progress/entities/progress-status.enum';
import { QuestionType } from '@/learn/enums/question-type.enum';

// Difficulty bands a question type can belong to. A word's mastery stage
// decides which bands are in play (see `eligibleTypesForStatus`): a new
// word sees every band, and the easiest band drops off as the word matures.
export enum DifficultyBand {
  NEW = 0, // recognition — easiest (flashcard + MCQ-style)
  REVIEW = 1, // recall — produce the form from memory
  MASTER = 2, // production — build / discriminate full output
}

// The full ladder, ascending difficulty. The order here IS the order a
// word's lesson presents its questions in. Each type is tagged with the
// band it belongs to.
const LADDER: { type: QuestionType; band: DifficultyBand }[] = [
  { type: QuestionType.FLASHCARD, band: DifficultyBand.NEW },
  { type: QuestionType.CLOZE_MCQ, band: DifficultyBand.NEW },
  { type: QuestionType.MEANING_IN_CONTEXT, band: DifficultyBand.NEW },
  { type: QuestionType.LISTENING_CLOZE, band: DifficultyBand.NEW },
  { type: QuestionType.CLOZE_TYPING, band: DifficultyBand.REVIEW },
  { type: QuestionType.SENSE_DISAMBIGUATION, band: DifficultyBand.REVIEW },
  { type: QuestionType.SENTENCE_BUILD, band: DifficultyBand.MASTER },
];

// The cloze family all blank a word in a sentence (so they re-use the same
// example). The per-lesson cap limits how many of these appear, to avoid
// blanking the same sentence several steps in a row.
const CLOZE_FAMILY: ReadonlySet<QuestionType> = new Set([
  QuestionType.CLOZE_MCQ,
  QuestionType.CLOZE_TYPING,
  QuestionType.LISTENING_CLOZE,
]);

export function isClozeFamily(type: QuestionType): boolean {
  return CLOZE_FAMILY.has(type);
}

export function bandOf(type: QuestionType): DifficultyBand {
  return LADDER.find((e) => e.type === type)!.band;
}

// Lowest band a word at this stage still practises. As a word matures the
// floor rises, so the easy recognition band drops away:
//   NEW       → from NEW band (the full ladder, incl. the flashcard)
//   LEARNING  → from REVIEW band (recognition dropped; word is past first
//               encounter)
//   REVIEW    → from REVIEW band
//   MASTERED  → from MASTER band only (hardest production)
function minBandForStatus(status: ProgressStatus): DifficultyBand {
  switch (status) {
    case ProgressStatus.NEW:
      return DifficultyBand.NEW;
    case ProgressStatus.LEARNING:
    case ProgressStatus.REVIEW:
      return DifficultyBand.REVIEW;
    case ProgressStatus.MASTERED:
      return DifficultyBand.MASTER;
  }
}

// The ordered (easy→hard) question types a word at this stage is eligible
// for. Data feasibility (translations, senses, audio) and the cloze-family
// cap are applied on top of this by the question builder.
export function eligibleTypesForStatus(status: ProgressStatus): QuestionType[] {
  const floor = minBandForStatus(status);
  return LADDER.filter((e) => e.band >= floor).map((e) => e.type);
}
