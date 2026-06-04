import { AnswerGraderService } from '@/learn/answer-grader.service';
import { QuestionType } from '@/learn/enums/question-type.enum';
import { PartOfSpeech } from '@/vocabularies/entities/part-of-speech.enum';
import type { VocabularyExample } from '@/vocabularies/entities/vocabulary-example.entity';
import type { VocabularySense } from '@/vocabularies/entities/vocabulary-sense.entity';
import type { Vocabulary } from '@/vocabularies/entities/vocabulary.entity';

const grader = new AnswerGraderService();

function makeVocab(overrides: Partial<Vocabulary> = {}): Vocabulary {
  return {
    id: 'v',
    lemma: 'study',
    language: 'en',
    partOfSpeech: PartOfSpeech.VERB,
    audioUrl: null,
    senses: [],
    ...overrides,
  } as unknown as Vocabulary;
}

function makeSense(overrides: Partial<VocabularySense> = {}): VocabularySense {
  return {
    id: 's1',
    translations: [{ language: 'vi', translation: 'học' }],
    examples: [],
    ...overrides,
  } as unknown as VocabularySense;
}

function makeExample(sentence: string): VocabularyExample {
  return { id: 'e1', sentence } as unknown as VocabularyExample;
}

describe('AnswerGraderService — CLOZE_MCQ', () => {
  it('correct + fast → quality 5', () => {
    const out = grader.grade({
      type: QuestionType.CLOZE_MCQ,
      vocab: makeVocab(),
      sense: makeSense(),
      example: makeExample('She studies biology.'),
      translationLang: null,
      userAnswer: 'studies',
      latencyMs: 2_000,
    });
    expect(out.correct).toBe(true);
    expect(out.correctAnswer).toBe('studies');
    expect(out.quality).toBe(5);
  });

  it('correct + slow → quality 4', () => {
    const out = grader.grade({
      type: QuestionType.CLOZE_MCQ,
      vocab: makeVocab(),
      sense: makeSense(),
      example: makeExample('She studies biology.'),
      translationLang: null,
      userAnswer: 'studies',
      latencyMs: 30_000,
    });
    expect(out.quality).toBe(4);
  });

  it('wrong → quality 2', () => {
    const out = grader.grade({
      type: QuestionType.CLOZE_MCQ,
      vocab: makeVocab(),
      sense: makeSense(),
      example: makeExample('She studies biology.'),
      translationLang: null,
      userAnswer: 'teaches',
      latencyMs: 2_000,
    });
    expect(out.correct).toBe(false);
    expect(out.quality).toBe(2);
  });
});

describe('AnswerGraderService — CLOZE_TYPING', () => {
  it('exact match + fast → 5', () => {
    const out = grader.grade({
      type: QuestionType.CLOZE_TYPING,
      vocab: makeVocab(),
      sense: makeSense(),
      example: makeExample('She studies biology.'),
      translationLang: null,
      userAnswer: 'studies',
      latencyMs: 3_000,
    });
    expect(out.quality).toBe(5);
  });

  it('one-edit typo → quality 3 (not correct)', () => {
    const out = grader.grade({
      type: QuestionType.CLOZE_TYPING,
      vocab: makeVocab(),
      sense: makeSense(),
      example: makeExample('She studies biology.'),
      translationLang: null,
      userAnswer: 'studes', // 1 edit from "studies"
      latencyMs: 3_000,
    });
    expect(out.correct).toBe(false);
    expect(out.quality).toBe(3);
  });

  it('far-off answer → quality 2', () => {
    const out = grader.grade({
      type: QuestionType.CLOZE_TYPING,
      vocab: makeVocab(),
      sense: makeSense(),
      example: makeExample('She studies biology.'),
      translationLang: null,
      userAnswer: 'banana',
      latencyMs: 3_000,
    });
    expect(out.quality).toBe(2);
  });
});

describe('AnswerGraderService — MEANING_IN_CONTEXT', () => {
  it('correct translation → 5', () => {
    const out = grader.grade({
      type: QuestionType.MEANING_IN_CONTEXT,
      vocab: makeVocab(),
      sense: makeSense(),
      example: makeExample('Scientists are studying climate change.'),
      translationLang: 'vi',
      userAnswer: 'học',
      latencyMs: 3_000,
    });
    expect(out.correct).toBe(true);
    expect(out.correctAnswer).toBe('học');
    expect(out.quality).toBe(5);
  });

  it('wrong translation → 2', () => {
    const out = grader.grade({
      type: QuestionType.MEANING_IN_CONTEXT,
      vocab: makeVocab(),
      sense: makeSense(),
      example: makeExample('Scientists are studying climate change.'),
      translationLang: 'vi',
      userAnswer: 'nghiên cứu',
      latencyMs: 3_000,
    });
    expect(out.correct).toBe(false);
    expect(out.quality).toBe(2);
  });
});

describe('AnswerGraderService — FLASHCARD (self-rated)', () => {
  function gradeRating(rating: string) {
    return grader.grade({
      type: QuestionType.FLASHCARD,
      vocab: makeVocab(),
      sense: makeSense(),
      example: makeExample('She studies biology.'),
      translationLang: 'vi',
      userAnswer: rating,
      latencyMs: 3_000,
    });
  }

  it('"forgot" → not correct, quality 1', () => {
    const out = gradeRating('forgot');
    expect(out.correct).toBe(false);
    expect(out.quality).toBe(1);
  });

  it('"hard" → correct, quality 3', () => {
    const out = gradeRating('hard');
    expect(out.correct).toBe(true);
    expect(out.quality).toBe(3);
  });

  it('"good" → correct, quality 4, reveals the sense translation', () => {
    const out = gradeRating('good');
    expect(out.correct).toBe(true);
    expect(out.quality).toBe(4);
    expect(out.correctAnswer).toBe('học');
  });

  it('"easy" → correct, quality 5', () => {
    expect(gradeRating('easy').quality).toBe(5);
  });

  it('unrecognised rating defaults to "good" (never hard-fails)', () => {
    expect(gradeRating('whatever').quality).toBe(4);
  });
});

describe('AnswerGraderService — lemma MCQ (WORD_FROM_TRANSLATION / LISTENING_CHOICE / IMAGE_CHOICE)', () => {
  for (const type of [
    QuestionType.WORD_FROM_TRANSLATION,
    QuestionType.LISTENING_CHOICE,
    QuestionType.IMAGE_CHOICE,
  ]) {
    it(`${type}: chose the lemma + fast → correct, quality 5`, () => {
      const out = grader.grade({
        type,
        vocab: makeVocab(),
        sense: makeSense(),
        example: makeExample('She studies biology.'),
        translationLang: 'vi',
        userAnswer: 'study',
        latencyMs: 2_000,
      });
      expect(out.correct).toBe(true);
      expect(out.correctAnswer).toBe('study');
      expect(out.quality).toBe(5);
    });

    it(`${type}: chose another lemma → wrong, quality 2`, () => {
      const out = grader.grade({
        type,
        vocab: makeVocab(),
        sense: makeSense(),
        example: makeExample('She studies biology.'),
        translationLang: 'vi',
        userAnswer: 'teach',
        latencyMs: 2_000,
      });
      expect(out.correct).toBe(false);
      expect(out.quality).toBe(2);
    });
  }
});

describe('AnswerGraderService — TRANSLATION_FROM_WORD (twin of meaning-in-context)', () => {
  it('correct translation → 5', () => {
    const out = grader.grade({
      type: QuestionType.TRANSLATION_FROM_WORD,
      vocab: makeVocab(),
      sense: makeSense(),
      example: makeExample('She studies biology.'),
      translationLang: 'vi',
      userAnswer: 'học',
      latencyMs: 2_000,
    });
    expect(out.correct).toBe(true);
    expect(out.correctAnswer).toBe('học');
    expect(out.quality).toBe(5);
  });

  it('wrong translation → 2', () => {
    const out = grader.grade({
      type: QuestionType.TRANSLATION_FROM_WORD,
      vocab: makeVocab(),
      sense: makeSense(),
      example: makeExample('She studies biology.'),
      translationLang: 'vi',
      userAnswer: 'nghiên cứu',
      latencyMs: 2_000,
    });
    expect(out.correct).toBe(false);
    expect(out.quality).toBe(2);
  });
});

describe('AnswerGraderService — lemma typing (DICTATION / PRONUNCIATION)', () => {
  for (const type of [QuestionType.DICTATION, QuestionType.PRONUNCIATION]) {
    it(`${type}: exact lemma + fast → correct, quality 5`, () => {
      const out = grader.grade({
        type,
        vocab: makeVocab(),
        sense: makeSense(),
        example: makeExample('She studies biology.'),
        translationLang: 'vi',
        userAnswer: 'study',
        latencyMs: 3_000,
      });
      expect(out.correct).toBe(true);
      expect(out.correctAnswer).toBe('study');
      expect(out.quality).toBe(5);
    });

    it(`${type}: one-edit typo → quality 3 (not correct)`, () => {
      const out = grader.grade({
        type,
        vocab: makeVocab(),
        sense: makeSense(),
        example: makeExample('She studies biology.'),
        translationLang: 'vi',
        userAnswer: 'studh', // 1 edit from "study"
        latencyMs: 3_000,
      });
      expect(out.correct).toBe(false);
      expect(out.quality).toBe(3);
    });

    it(`${type}: far-off answer → quality 2`, () => {
      const out = grader.grade({
        type,
        vocab: makeVocab(),
        sense: makeSense(),
        example: makeExample('She studies biology.'),
        translationLang: 'vi',
        userAnswer: 'banana',
        latencyMs: 3_000,
      });
      expect(out.quality).toBe(2);
    });
  }
});

describe('AnswerGraderService — SENSE_DISAMBIGUATION', () => {
  it('picks translation of the example sentence sense', () => {
    const out = grader.grade({
      type: QuestionType.SENSE_DISAMBIGUATION,
      vocab: makeVocab(),
      sense: makeSense({
        translations: [{ language: 'vi', translation: 'nghiên cứu' }] as never,
      }),
      example: makeExample('Scientists are studying climate change.'),
      translationLang: 'vi',
      userAnswer: 'nghiên cứu',
      latencyMs: 3_000,
    });
    expect(out.correct).toBe(true);
    expect(out.quality).toBe(5);
  });
});
