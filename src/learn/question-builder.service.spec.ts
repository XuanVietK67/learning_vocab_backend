import {
  BuildContext,
  QuestionBuilderService,
} from '@/learn/question-builder.service';
import {
  bandOf,
  DifficultyBand,
  eligibleTypesForStatus,
} from '@/learn/question-bands';
import { QuestionType } from '@/learn/enums/question-type.enum';
import { ProgressStatus } from '@/progress/entities/progress-status.enum';
import { PartOfSpeech } from '@/vocabularies/entities/part-of-speech.enum';
import { Vocabulary } from '@/vocabularies/entities/vocabulary.entity';

// Minimal structural fixtures cast to the entity types — the builder only
// reads a handful of fields.
function makeExample(id: string, sentence: string, translation?: string) {
  return { id, sentence, translation: translation ?? null };
}

function makeSense(
  id: string,
  examples: ReturnType<typeof makeExample>[],
  translations: { language: string; translation: string }[] = [],
  imageUrl: string | null = null,
) {
  return {
    id,
    examples,
    translations,
    imageUrl,
    gloss: null,
    definition: null,
    synonyms: [],
    antonyms: [],
  };
}

function makeVocab(
  overrides: Partial<Record<string, unknown>> = {},
): Vocabulary {
  return {
    id: 'voc-1',
    lemma: 'run',
    partOfSpeech: PartOfSpeech.VERB,
    ipa: '/rʌn/',
    audioUrl: null,
    senses: [
      makeSense('sense-1', [makeExample('ex-1', 'I run every morning')]),
    ],
    ...overrides,
  } as unknown as Vocabulary;
}

function makeCtx(overrides: Partial<BuildContext> = {}): BuildContext {
  return {
    vocab: makeVocab(),
    status: ProgressStatus.NEW,
    translationLang: null,
    ...overrides,
  };
}

// A word with audio, a vi translation per sense, and two senses — feasible
// for every question type.
const richVocab = () =>
  makeVocab({
    audioUrl: 'https://cdn/audio.mp3',
    senses: [
      makeSense(
        'sense-1',
        [makeExample('ex-1', 'I run every morning')],
        [{ language: 'vi', translation: 'chạy' }],
      ),
      makeSense(
        'sense-2',
        [makeExample('ex-2', 'They run a company')],
        [{ language: 'vi', translation: 'điều hành' }],
      ),
    ],
  });

function clozeFamilyCount(types: QuestionType[]): number {
  const family = new Set<QuestionType>([
    QuestionType.CLOZE_MCQ,
    QuestionType.CLOZE_TYPING,
    QuestionType.LISTENING_CLOZE,
  ]);
  return types.filter((t) => family.has(t)).length;
}

describe('question-bands — eligibleTypesForStatus', () => {
  it('NEW → the full ladder, flashcard first', () => {
    const types = eligibleTypesForStatus(ProgressStatus.NEW);
    expect(types[0]).toBe(QuestionType.FLASHCARD);
    expect(types).toContain(QuestionType.CLOZE_MCQ);
    expect(types).toContain(QuestionType.SENSE_DISAMBIGUATION);
  });

  it('LEARNING/REVIEW → Review+Master only (recognition dropped)', () => {
    for (const status of [ProgressStatus.LEARNING, ProgressStatus.REVIEW]) {
      const types = eligibleTypesForStatus(status);
      expect(types).not.toContain(QuestionType.FLASHCARD);
      expect(types).not.toContain(QuestionType.CLOZE_MCQ);
      expect(types).not.toContain(QuestionType.MEANING_IN_CONTEXT);
      expect(types).not.toContain(QuestionType.LISTENING_CLOZE);
      expect(types).toContain(QuestionType.CLOZE_TYPING);
      expect(types).toContain(QuestionType.SENSE_DISAMBIGUATION);
    }
  });

  it('MASTERED → Master band only', () => {
    expect(eligibleTypesForStatus(ProgressStatus.MASTERED)).toEqual([
      QuestionType.SENSE_DISAMBIGUATION,
    ]);
  });
});

describe('QuestionBuilderService — buildLadder', () => {
  let service: QuestionBuilderService;
  const distractor = {
    pickLemmaDistractors: jest.fn(),
    pickTranslationDistractors: jest.fn(),
  };

  beforeEach(() => {
    distractor.pickLemmaDistractors.mockReset();
    distractor.pickTranslationDistractors.mockReset();
    distractor.pickLemmaDistractors.mockResolvedValue([
      'ran',
      'jogged',
      'walked',
    ]);
    distractor.pickTranslationDistractors.mockResolvedValue(['a', 'b', 'c']);
    service = new QuestionBuilderService(
      distractor as never,
      // High per-band cap so these tests assert pure feasibility/ordering
      // without the sampling cap dropping types. Cap behaviour is covered in
      // its own block below.
      { clozeFamilyCapPerLesson: 2, maxTypesPerBand: 99 } as never,
    );
  });

  it('NEW: leads with the flashcard and spans recognition→production', async () => {
    const ladder = await service.buildLadder(
      makeCtx({ vocab: richVocab(), translationLang: 'vi' }),
    );
    const types = ladder.map((q) => q.type);
    expect(types[0]).toBe(QuestionType.FLASHCARD);
    expect(types).toEqual(
      expect.arrayContaining([
        QuestionType.CLOZE_MCQ,
        QuestionType.MEANING_IN_CONTEXT,
        QuestionType.LISTENING_CLOZE,
        QuestionType.SENSE_DISAMBIGUATION,
      ]),
    );
  });

  it('caps the cloze family per lesson', async () => {
    const ladder = await service.buildLadder(
      makeCtx({ vocab: richVocab(), translationLang: 'vi' }),
    );
    expect(clozeFamilyCount(ladder.map((q) => q.type))).toBeLessThanOrEqual(2);
  });

  it('LEARNING: drops the New band, keeps recall + production', async () => {
    const ladder = await service.buildLadder(
      makeCtx({
        vocab: richVocab(),
        translationLang: 'vi',
        status: ProgressStatus.LEARNING,
      }),
    );
    const types = ladder.map((q) => q.type);
    expect(types).not.toContain(QuestionType.FLASHCARD);
    expect(types).not.toContain(QuestionType.CLOZE_MCQ);
    expect(types).toEqual(
      expect.arrayContaining([
        QuestionType.CLOZE_TYPING,
        QuestionType.SENSE_DISAMBIGUATION,
      ]),
    );
  });

  it('MASTERED: production only', async () => {
    const ladder = await service.buildLadder(
      makeCtx({
        vocab: richVocab(),
        translationLang: 'vi',
        status: ProgressStatus.MASTERED,
      }),
    );
    expect(ladder.map((q) => q.type)).toEqual([
      QuestionType.SENSE_DISAMBIGUATION,
    ]);
  });

  it('sense_disambiguation renders ONE sentence with up to four meaning options', async () => {
    const ladder = await service.buildLadder(
      makeCtx({
        vocab: richVocab(),
        translationLang: 'vi',
        status: ProgressStatus.MASTERED,
      }),
    );
    const prompt = ladder[0].prompt as {
      type: QuestionType;
      sentence: string;
      options: string[];
      sentences?: unknown;
    };
    // Single sentence, not the old two-sentence matching array.
    expect(typeof prompt.sentence).toBe('string');
    expect(prompt.sentences).toBeUndefined();
    // Graded sense translation + the same-word trap are both offered.
    expect(prompt.options).toContain('chạy');
    expect(prompt.options).toContain('điều hành');
    expect(prompt.options.length).toBeGreaterThan(2);
    expect(prompt.options.length).toBeLessThanOrEqual(4);
  });

  it('sense_disambiguation needs a same-word trap (single-sense word → not built)', async () => {
    const ladder = await service.buildLadder(
      makeCtx({
        vocab: makeVocab({
          senses: [
            makeSense(
              'sense-1',
              [makeExample('ex-1', 'I run every morning')],
              [{ language: 'vi', translation: 'chạy' }],
            ),
          ],
        }),
        translationLang: 'vi',
        status: ProgressStatus.MASTERED,
      }),
    );
    expect(ladder.map((q) => q.type)).not.toContain(
      QuestionType.SENSE_DISAMBIGUATION,
    );
  });

  it('cloze typing surfaces in NEW when listening is infeasible (no audio frees the cap)', async () => {
    const ladder = await service.buildLadder(
      makeCtx({
        vocab: makeVocab({
          audioUrl: null,
          senses: [
            makeSense(
              'sense-1',
              [makeExample('ex-1', 'I run every morning')],
              [{ language: 'vi', translation: 'chạy' }],
            ),
          ],
        }),
        translationLang: 'vi',
      }),
    );
    const types = ladder.map((q) => q.type);
    expect(types).not.toContain(QuestionType.LISTENING_CLOZE);
    expect(types).toContain(QuestionType.CLOZE_TYPING);
  });

  it('feasibility gates: no translation/audio → flashcard still leads, no translation-only types', async () => {
    const ladder = await service.buildLadder(
      makeCtx({ translationLang: null }),
    );
    const types = ladder.map((q) => q.type);
    expect(types[0]).toBe(QuestionType.FLASHCARD);
    expect(types).not.toContain(QuestionType.MEANING_IN_CONTEXT);
    expect(types).not.toContain(QuestionType.SENSE_DISAMBIGUATION);
    expect(types).not.toContain(QuestionType.LISTENING_CLOZE);
  });

  it('empty ladder when the word has no examples at all', async () => {
    const ladder = await service.buildLadder(
      makeCtx({
        vocab: makeVocab({ senses: [makeSense('s', [])] }),
        translationLang: 'vi',
      }),
    );
    expect(ladder).toEqual([]);
  });
});

describe('QuestionBuilderService — new question types', () => {
  let service: QuestionBuilderService;
  const distractor = {
    pickLemmaDistractors: jest.fn(),
    pickTranslationDistractors: jest.fn(),
  };

  beforeEach(() => {
    distractor.pickLemmaDistractors.mockReset();
    distractor.pickTranslationDistractors.mockReset();
    distractor.pickLemmaDistractors.mockResolvedValue(['ran', 'jog', 'walk']);
    distractor.pickTranslationDistractors.mockResolvedValue(['a', 'b', 'c']);
    // No sampling: surface every feasible type so we can assert presence.
    service = new QuestionBuilderService(
      distractor as never,
      {
        clozeFamilyCapPerLesson: 99,
        maxTypesPerBand: 99,
      } as never,
    );
  });

  it('translation↔lemma pair appears when a translation is available', async () => {
    const ladder = await service.buildLadder(
      makeCtx({ vocab: richVocab(), translationLang: 'vi' }),
    );
    const types = ladder.map((q) => q.type);
    expect(types).toContain(QuestionType.WORD_FROM_TRANSLATION);
    expect(types).toContain(QuestionType.TRANSLATION_FROM_WORD);
  });

  it('audio types (listening_choice, dictation) appear when audio is present', async () => {
    const ladder = await service.buildLadder(
      makeCtx({ vocab: richVocab(), translationLang: 'vi' }),
    );
    const types = ladder.map((q) => q.type);
    expect(types).toContain(QuestionType.LISTENING_CHOICE);
    expect(types).toContain(QuestionType.DICTATION);
  });

  it('image_choice appears only when a sense has an image', async () => {
    const withImage = makeVocab({
      senses: [
        makeSense(
          'sense-1',
          [makeExample('ex-1', 'I run every morning')],
          [{ language: 'vi', translation: 'chạy' }],
          'https://cdn/run.jpg',
        ),
      ],
    });
    const withImageLadder = await service.buildLadder(
      makeCtx({ vocab: withImage, translationLang: 'vi' }),
    );
    expect(withImageLadder.map((q) => q.type)).toContain(
      QuestionType.IMAGE_CHOICE,
    );

    const noImageLadder = await service.buildLadder(
      makeCtx({ vocab: richVocab(), translationLang: 'vi' }),
    );
    expect(noImageLadder.map((q) => q.type)).not.toContain(
      QuestionType.IMAGE_CHOICE,
    );
  });

  it('pronunciation needs only an example — present without audio or translation', async () => {
    const ladder = await service.buildLadder(
      makeCtx({ translationLang: null }),
    );
    const types = ladder.map((q) => q.type);
    expect(types).toContain(QuestionType.PRONUNCIATION);
    // No audio/translation, so these stay out:
    expect(types).not.toContain(QuestionType.LISTENING_CHOICE);
    expect(types).not.toContain(QuestionType.DICTATION);
    expect(types).not.toContain(QuestionType.WORD_FROM_TRANSLATION);
  });
});

describe('QuestionBuilderService — per-band sampling cap', () => {
  let service: QuestionBuilderService;
  const distractor = {
    pickLemmaDistractors: jest.fn().mockResolvedValue(['ran', 'jog', 'walk']),
    pickTranslationDistractors: jest.fn().mockResolvedValue(['a', 'b', 'c']),
  };

  beforeEach(() => {
    // Cap each band at 1 sampled quiz type (flashcard is exempt).
    service = new QuestionBuilderService(
      distractor as never,
      {
        clozeFamilyCapPerLesson: 99,
        maxTypesPerBand: 1,
      } as never,
    );
  });

  it('keeps the flashcard plus at most one sampled NEW-band type', async () => {
    const ladder = await service.buildLadder(
      makeCtx({ vocab: richVocab(), translationLang: 'vi' }),
    );
    const types = ladder.map((q) => q.type);
    expect(types[0]).toBe(QuestionType.FLASHCARD);
    const newBand = types.filter((t) => bandOf(t) === DifficultyBand.NEW);
    // flashcard (forced) + at most 1 sampled optional type.
    expect(newBand.length).toBeLessThanOrEqual(2);
    expect(newBand).toContain(QuestionType.FLASHCARD);
  });

  it('caps each non-NEW band to the sampled count too', async () => {
    const ladder = await service.buildLadder(
      makeCtx({
        vocab: richVocab(),
        translationLang: 'vi',
        status: ProgressStatus.LEARNING,
      }),
    );
    const types = ladder.map((q) => q.type);
    const review = types.filter((t) => bandOf(t) === DifficultyBand.REVIEW);
    expect(review.length).toBeLessThanOrEqual(1);
  });

  it('is deterministic for the same vocab id', async () => {
    const ctx = () => makeCtx({ vocab: richVocab(), translationLang: 'vi' });
    const a = (await service.buildLadder(ctx())).map((q) => q.type);
    const b = (await service.buildLadder(ctx())).map((q) => q.type);
    expect(a).toEqual(b);
  });

  it('samplingKey makes two different words sample the same types (uniform rounds)', async () => {
    const wordA = richVocab(); // id 'voc-1'
    const wordB = { ...richVocab(), id: 'voc-2' };
    const samplingKey = 'session-abc';
    const a = (
      await service.buildLadder(
        makeCtx({ vocab: wordA, translationLang: 'vi', samplingKey }),
      )
    ).map((q) => q.type);
    const b = (
      await service.buildLadder(
        makeCtx({ vocab: wordB, translationLang: 'vi', samplingKey }),
      )
    ).map((q) => q.type);
    // Same key + same feasibility ⇒ the per-band sampling lands on the same
    // types for both words, so a type-major round holds every word.
    expect(b).toEqual(a);
  });
});
