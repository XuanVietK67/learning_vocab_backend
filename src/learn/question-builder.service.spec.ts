import {
  BuildContext,
  QuestionBuilderService,
} from '@/learn/question-builder.service';
import { QuestionType } from '@/learn/enums/question-type.enum';
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
) {
  return { id, examples, translations };
}

function makeVocab(
  overrides: Partial<Record<string, unknown>> = {},
): Vocabulary {
  return {
    id: 'voc-1',
    lemma: 'run',
    partOfSpeech: PartOfSpeech.VERB,
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
    correctCount: 0,
    translationLang: null,
    daySeed: '2026-05-30',
    rotationKey: '0',
    ...overrides,
  };
}

describe('QuestionBuilderService — exercise tiers', () => {
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
      {
        exerciseTierThresholds: [2, 4],
      } as never,
    );
  });

  // Reach into the private pool builder so tier/weight logic can be asserted
  // without making every type buildable from fixtures.
  function poolMap(ctx: BuildContext): Map<QuestionType, number> {
    const pool = (
      service as unknown as {
        candidatePool(
          c: BuildContext,
        ): { type: QuestionType; weight: number }[];
      }
    ).candidatePool(ctx);
    return new Map(pool.map((p) => [p.type, p.weight]));
  }

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

  describe('tier gating from correctCount', () => {
    it('tier 0 (cc<2): only recognition types, no recall/production', () => {
      const m = poolMap(
        makeCtx({ vocab: richVocab(), translationLang: 'vi', correctCount: 1 }),
      );
      expect(m.get(QuestionType.CLOZE_MCQ)).toBe(3);
      expect(m.get(QuestionType.MEANING_IN_CONTEXT)).toBe(3);
      expect(m.get(QuestionType.LISTENING_CLOZE)).toBe(3);
      expect(m.has(QuestionType.CLOZE_TYPING)).toBe(false);
      expect(m.has(QuestionType.SENTENCE_BUILD)).toBe(false);
      expect(m.has(QuestionType.SENSE_DISAMBIGUATION)).toBe(false);
    });

    it('tier 1 (2≤cc<4): recall unlocks, recognition stays at lower weight', () => {
      const m = poolMap(
        makeCtx({ vocab: richVocab(), translationLang: 'vi', correctCount: 2 }),
      );
      expect(m.get(QuestionType.CLOZE_TYPING)).toBe(3);
      expect(m.get(QuestionType.CLOZE_MCQ)).toBe(2);
      expect(m.get(QuestionType.MEANING_IN_CONTEXT)).toBe(2);
      expect(m.has(QuestionType.SENTENCE_BUILD)).toBe(false);
      expect(m.has(QuestionType.SENSE_DISAMBIGUATION)).toBe(false);
    });

    it('tier 2 (cc≥4): production unlocks, lower tiers retained for variety', () => {
      const m = poolMap(
        makeCtx({ vocab: richVocab(), translationLang: 'vi', correctCount: 4 }),
      );
      expect(m.get(QuestionType.SENTENCE_BUILD)).toBe(3);
      expect(m.get(QuestionType.SENSE_DISAMBIGUATION)).toBe(3);
      expect(m.get(QuestionType.CLOZE_TYPING)).toBe(2);
      expect(m.get(QuestionType.CLOZE_MCQ)).toBe(1);
      expect(m.get(QuestionType.LISTENING_CLOZE)).toBe(1);
    });

    it('thresholds are config-driven', () => {
      const svc = new QuestionBuilderService(
        distractor as never,
        {
          exerciseTierThresholds: [1, 2],
        } as never,
      );
      const pool = (
        svc as unknown as {
          candidatePool(c: BuildContext): { type: QuestionType }[];
        }
      ).candidatePool(makeCtx({ correctCount: 1 }));
      // cc=1 is already tier 1 under [1,2] → typing present.
      expect(pool.map((p) => p.type)).toContain(QuestionType.CLOZE_TYPING);
    });
  });

  describe('data feasibility still hard-gates', () => {
    it('no translationLang → translation-dependent types never appear', () => {
      const m = poolMap(
        makeCtx({ vocab: richVocab(), translationLang: null, correctCount: 9 }),
      );
      expect(m.has(QuestionType.MEANING_IN_CONTEXT)).toBe(false);
      expect(m.has(QuestionType.SENTENCE_BUILD)).toBe(false);
      expect(m.has(QuestionType.SENSE_DISAMBIGUATION)).toBe(false);
      // recognition + recall remain
      expect(m.has(QuestionType.CLOZE_MCQ)).toBe(true);
      expect(m.has(QuestionType.CLOZE_TYPING)).toBe(true);
    });

    it('no audio → listening cloze never appears', () => {
      const m = poolMap(
        makeCtx({
          vocab: makeVocab({ audioUrl: null }),
          translationLang: 'vi',
          correctCount: 9,
        }),
      );
      expect(m.has(QuestionType.LISTENING_CLOZE)).toBe(false);
    });

    it('single sense → sense disambiguation never appears', () => {
      const m = poolMap(
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
          correctCount: 9,
        }),
      );
      expect(m.has(QuestionType.SENSE_DISAMBIGUATION)).toBe(false);
      expect(m.has(QuestionType.SENTENCE_BUILD)).toBe(true);
    });
  });

  describe('build() — selection, determinism, anti-repeat', () => {
    it('tier 0 never produces a recall/production type', async () => {
      const types = new Set<QuestionType>();
      for (let i = 0; i < 30; i++) {
        const built = await service.build(makeCtx({ rotationKey: String(i) }));
        if (built) types.add(built.type);
      }
      expect(types).toEqual(new Set([QuestionType.CLOZE_MCQ]));
    });

    it('same seed → same type (reproducible)', async () => {
      const ctx = makeCtx({ correctCount: 2, rotationKey: '5' });
      const a = await service.build(ctx);
      const b = await service.build(ctx);
      expect(a?.type).toBe(b?.type);
    });

    it('rotationKey rotates the type (breaks within-session repeat)', async () => {
      const types = new Set<QuestionType>();
      for (let i = 0; i < 30; i++) {
        const built = await service.build(
          makeCtx({ correctCount: 2, rotationKey: String(i) }),
        );
        if (built) types.add(built.type);
      }
      // tier 1, no translation/audio → pool is {MCQ, CLOZE_TYPING}; both
      // must surface across rotations.
      expect(types.has(QuestionType.CLOZE_MCQ)).toBe(true);
      expect(types.has(QuestionType.CLOZE_TYPING)).toBe(true);
    });

    it('returns null when no example contains the lemma', async () => {
      const built = await service.build(
        makeCtx({
          vocab: makeVocab({
            lemma: 'xylophone',
            partOfSpeech: PartOfSpeech.NOUN,
            senses: [
              makeSense('s', [makeExample('e', 'nothing matches here')]),
            ],
          }),
        }),
      );
      expect(built).toBeNull();
    });
  });
});
