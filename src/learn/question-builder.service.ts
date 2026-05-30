import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import learnConfig from '@/config/learn.config';
import {
  ClozeMcqPrompt,
  ClozeTypingPrompt,
  ListeningClozePrompt,
  MeaningInContextPrompt,
  SenseDisambiguationPrompt,
  SentenceBuildPrompt,
  SessionItemPrompt,
} from '@/learn/dto/session-item.dto';
import {
  buildCloze,
  deterministicShuffle,
  findLemmaSpan,
  tokenizeSentence,
} from '@/learn/cloze.util';
import { DistractorService } from '@/learn/distractor.service';
import { QuestionType } from '@/learn/enums/question-type.enum';
import { VocabularyExample } from '@/vocabularies/entities/vocabulary-example.entity';
import { VocabularySense } from '@/vocabularies/entities/vocabulary-sense.entity';
import { Vocabulary } from '@/vocabularies/entities/vocabulary.entity';

export interface BuildContext {
  vocab: Vocabulary;
  // Successful-exposure count for this user+word. Drives the exercise
  // tier (recognition → recall → production), decoupled from SRS status.
  correctCount: number;
  translationLang: string | null;
  daySeed: string;
  // Salt folded into the type-pick seed so a card re-shown within a
  // session (intra-session requeue) rotates to a different question type
  // instead of replaying the same one. Typically the running attempt
  // count (correctCount + incorrectCount).
  rotationKey: string;
  // Skip examples whose IDs appear here. Used by the intra-session
  // requeue path so a re-shown card doesn't repeat the same prompt the
  // user just answered. Optional — empty/absent means no exclusions.
  excludeExampleIds?: Set<string>;
}

interface WeightedType {
  type: QuestionType;
  weight: number;
}

export interface BuiltQuestion {
  type: QuestionType;
  exampleId: string;
  prompt: SessionItemPrompt;
}

@Injectable()
export class QuestionBuilderService {
  constructor(
    private readonly distractor: DistractorService,
    @Inject(learnConfig.KEY)
    private readonly cfg: ConfigType<typeof learnConfig>,
  ) {}

  // Picks a question type appropriate for the card's exercise tier (driven
  // by successful exposures, not SRS status) and the available data, then
  // builds the matching prompt. Returns null if no type can be built (e.g.
  // no example contains a matchable lemma form).
  async build(ctx: BuildContext): Promise<BuiltQuestion | null> {
    const pool = this.candidatePool(ctx);
    if (pool.length === 0) return null;

    // A weighted deterministic ordering: the first entry is the weighted
    // pick, the rest form the fallback order if its data can't build.
    const ordered = weightedOrder(
      pool,
      `${ctx.daySeed}#${ctx.vocab.id}#${ctx.rotationKey}`,
    );
    for (const type of ordered) {
      const built = await this.tryBuild(type, ctx);
      if (built) return built;
    }
    return null;
  }

  // Maps successful-exposure count to an exercise tier, then assembles a
  // weighted pool of types up to that tier. Higher tiers unlock harder
  // formats while lower tiers stay in the pool (at reduced weight) so
  // sessions keep variety instead of locking to one format. Data
  // feasibility (translations, senses, audio) gates each type on top.
  private candidatePool(ctx: BuildContext): WeightedType[] {
    const tier = this.tierFor(ctx.correctCount);
    const { vocab } = ctx;
    const hasMultipleSenses = (vocab.senses?.length ?? 0) >= 2;
    const hasAudio = !!vocab.audioUrl;
    const hasTranslationLang = !!ctx.translationLang;

    // introTier = first tier at which the type becomes eligible.
    const candidates: {
      type: QuestionType;
      introTier: number;
      feasible: boolean;
    }[] = [
      { type: QuestionType.CLOZE_MCQ, introTier: 0, feasible: true },
      {
        type: QuestionType.MEANING_IN_CONTEXT,
        introTier: 0,
        feasible: hasTranslationLang,
      },
      {
        type: QuestionType.LISTENING_CLOZE,
        introTier: 0,
        feasible: hasAudio,
      },
      { type: QuestionType.CLOZE_TYPING, introTier: 1, feasible: true },
      {
        type: QuestionType.SENTENCE_BUILD,
        introTier: 2,
        feasible: hasTranslationLang,
      },
      {
        type: QuestionType.SENSE_DISAMBIGUATION,
        introTier: 2,
        feasible: hasTranslationLang && hasMultipleSenses,
      },
    ];

    const pool: WeightedType[] = [];
    for (const c of candidates) {
      if (!c.feasible || c.introTier > tier) continue;
      // Newest unlocked tier gets the spotlight (weight 3); each tier below
      // drops a point, floored at 1 so it never fully disappears.
      const weight = Math.max(1, 3 - (tier - c.introTier));
      pool.push({ type: c.type, weight });
    }
    return pool;
  }

  private tierFor(correctCount: number): number {
    const [t0, t1] = this.cfg.exerciseTierThresholds;
    if (correctCount >= t1) return 2;
    if (correctCount >= t0) return 1;
    return 0;
  }

  private async tryBuild(
    type: QuestionType,
    ctx: BuildContext,
  ): Promise<BuiltQuestion | null> {
    switch (type) {
      case QuestionType.CLOZE_MCQ:
        return this.buildClozeMcq(ctx);
      case QuestionType.CLOZE_TYPING:
        return this.buildClozeTyping(ctx);
      case QuestionType.MEANING_IN_CONTEXT:
        return this.buildMeaningInContext(ctx);
      case QuestionType.SENTENCE_BUILD:
        return this.buildSentenceBuild(ctx);
      case QuestionType.SENSE_DISAMBIGUATION:
        return this.buildSenseDisambiguation(ctx);
      case QuestionType.LISTENING_CLOZE:
        return this.buildListeningCloze(ctx);
    }
  }

  // --------------------------------------------------------------------
  // Individual builders

  private async buildClozeMcq(
    ctx: BuildContext,
  ): Promise<BuiltQuestion | null> {
    const picked = this.pickExampleForCloze(ctx.vocab, ctx.excludeExampleIds);
    if (!picked) return null;
    const { example, sense, sentenceWithBlank, blankedForm } = picked;

    const distractors = await this.distractor.pickLemmaDistractors(
      ctx.vocab,
      3,
    );
    if (distractors.length < 3) return null;

    const options = deterministicShuffle(
      [blankedForm, ...distractors],
      `mcq-${example.id}`,
    );
    const hint = ctx.translationLang
      ? firstTranslationOfSense(sense, ctx.translationLang)
      : null;

    const prompt: ClozeMcqPrompt = {
      type: QuestionType.CLOZE_MCQ,
      sentenceWithBlank,
      hintTranslation: example.translation ?? hint,
      audioUrl: ctx.vocab.audioUrl ?? null,
      options,
    };
    return { type: QuestionType.CLOZE_MCQ, exampleId: example.id, prompt };
  }

  private buildClozeTyping(ctx: BuildContext): BuiltQuestion | null {
    const picked = this.pickExampleForCloze(ctx.vocab, ctx.excludeExampleIds);
    if (!picked) return null;
    const { example, sense, sentenceWithBlank } = picked;
    const hint = ctx.translationLang
      ? firstTranslationOfSense(sense, ctx.translationLang)
      : null;

    const prompt: ClozeTypingPrompt = {
      type: QuestionType.CLOZE_TYPING,
      sentenceWithBlank,
      hintTranslation: example.translation ?? hint,
      audioUrl: ctx.vocab.audioUrl ?? null,
    };
    return { type: QuestionType.CLOZE_TYPING, exampleId: example.id, prompt };
  }

  private async buildMeaningInContext(
    ctx: BuildContext,
  ): Promise<BuiltQuestion | null> {
    if (!ctx.translationLang) return null;

    // Pick a sense that has at least one translation in target lang and
    // at least one example with the lemma present.
    for (const sense of ctx.vocab.senses ?? []) {
      const trans = (sense.translations ?? []).filter(
        (t) => t.language === ctx.translationLang,
      );
      if (trans.length === 0) continue;
      const examples = sense.examples ?? [];
      const exampleWithSpan = findExampleWithSpan(
        examples,
        ctx.vocab,
        ctx.excludeExampleIds,
      );
      if (!exampleWithSpan) continue;

      const correct = trans[0].translation;

      // Trap distractor = a translation from another sense, same target lang
      const trap = findTrapTranslation(
        ctx.vocab,
        sense.id,
        ctx.translationLang,
      );
      const exclude = [correct, ...(trap ? [trap] : [])];
      const needed = trap ? 2 : 3;
      const others = await this.distractor.pickTranslationDistractors(
        ctx.vocab,
        ctx.translationLang,
        exclude,
        needed,
      );
      const optionPool = [correct, ...(trap ? [trap] : []), ...others];
      if (optionPool.length < 4) continue;
      const options = deterministicShuffle(
        optionPool.slice(0, 4),
        `mic-${exampleWithSpan.example.id}`,
      );

      const prompt: MeaningInContextPrompt = {
        type: QuestionType.MEANING_IN_CONTEXT,
        sentence: exampleWithSpan.example.sentence,
        highlightedSpan: {
          start: exampleWithSpan.start,
          end: exampleWithSpan.end,
        },
        options,
      };
      return {
        type: QuestionType.MEANING_IN_CONTEXT,
        exampleId: exampleWithSpan.example.id,
        prompt,
      };
    }
    return null;
  }

  private buildSentenceBuild(ctx: BuildContext): BuiltQuestion | null {
    if (!ctx.translationLang) return null;
    for (const sense of ctx.vocab.senses ?? []) {
      for (const ex of sense.examples ?? []) {
        if (ctx.excludeExampleIds?.has(ex.id)) continue;
        const translation =
          ex.translation ?? firstTranslationOfSense(sense, ctx.translationLang);
        if (!translation) continue;
        const tokens = tokenizeSentence(ex.sentence);
        if (tokens.length < 3 || tokens.length > 18) continue;
        const shuffled = deterministicShuffle(tokens, `sb-${ex.id}`);
        const prompt: SentenceBuildPrompt = {
          type: QuestionType.SENTENCE_BUILD,
          translation,
          tokens: shuffled,
        };
        return { type: QuestionType.SENTENCE_BUILD, exampleId: ex.id, prompt };
      }
    }
    return null;
  }

  private buildSenseDisambiguation(ctx: BuildContext): BuiltQuestion | null {
    if (!ctx.translationLang) return null;
    const eligibleSenses: VocabularySense[] = [];
    for (const sense of ctx.vocab.senses ?? []) {
      const hasTrans = (sense.translations ?? []).some(
        (t) => t.language === ctx.translationLang,
      );
      const hasExample = (sense.examples ?? []).length > 0;
      if (hasTrans && hasExample) eligibleSenses.push(sense);
      if (eligibleSenses.length >= 2) break;
    }
    if (eligibleSenses.length < 2) return null;

    const senseA = eligibleSenses[0];
    const senseB = eligibleSenses[1];
    const exA = senseA.examples[0];
    const exB = senseB.examples[0];
    const transA = senseA.translations.find(
      (t) => t.language === ctx.translationLang,
    )!.translation;
    const transB = senseB.translations.find(
      (t) => t.language === ctx.translationLang,
    )!.translation;

    // The exampleId tied to the question is the FIRST sentence's example;
    // the answer-grader will reconstruct the correct ordering from the
    // server-side senses on submission.
    const sentences = [
      { exampleId: exA.id, sentence: exA.sentence },
      { exampleId: exB.id, sentence: exB.sentence },
    ];
    const options = deterministicShuffle(
      [transA, transB],
      `sd-${ctx.vocab.id}`,
    );
    const prompt: SenseDisambiguationPrompt = {
      type: QuestionType.SENSE_DISAMBIGUATION,
      sentences,
      options,
    };
    return {
      type: QuestionType.SENSE_DISAMBIGUATION,
      exampleId: exA.id,
      prompt,
    };
  }

  private async buildListeningCloze(
    ctx: BuildContext,
  ): Promise<BuiltQuestion | null> {
    if (!ctx.vocab.audioUrl) return null;
    const picked = this.pickExampleForCloze(ctx.vocab, ctx.excludeExampleIds);
    if (!picked) return null;
    const { example, sense, sentenceWithBlank, blankedForm } = picked;
    const distractors = await this.distractor.pickLemmaDistractors(
      ctx.vocab,
      3,
    );
    if (distractors.length < 3) return null;
    const options = deterministicShuffle(
      [blankedForm, ...distractors],
      `lc-${example.id}`,
    );
    const hint = ctx.translationLang
      ? firstTranslationOfSense(sense, ctx.translationLang)
      : null;
    const prompt: ListeningClozePrompt = {
      type: QuestionType.LISTENING_CLOZE,
      audioUrl: ctx.vocab.audioUrl,
      sentenceWithBlank,
      hintTranslation: example.translation ?? hint,
      options,
    };
    return {
      type: QuestionType.LISTENING_CLOZE,
      exampleId: example.id,
      prompt,
    };
  }

  // Iterate (sense, example) pairs and pick the first that contains a
  // matchable lemma form. Senses appear in senseOrder ASC; we don't
  // pick the very first example to preserve a "shown during study"
  // slot — but if only 2 examples exist we use either.
  private pickExampleForCloze(
    vocab: Vocabulary,
    excludeExampleIds?: Set<string>,
  ): {
    example: VocabularyExample;
    sense: VocabularySense;
    sentenceWithBlank: string;
    blankedForm: string;
  } | null {
    for (const sense of vocab.senses ?? []) {
      const examples = sense.examples ?? [];
      for (let i = 0; i < examples.length; i++) {
        // Prefer non-primary (i.e., not the first) when at least 3 exist
        if (examples.length >= 3 && i === 0) continue;
        const ex = examples[i];
        if (excludeExampleIds?.has(ex.id)) continue;
        const cloze = buildCloze(ex.sentence, vocab.lemma, vocab.partOfSpeech);
        if (cloze) {
          return { example: ex, sense, ...cloze };
        }
      }
      // If 2 examples and we skipped above, try index 0 as fallback
      if (examples.length === 2) {
        const ex = examples[0];
        if (excludeExampleIds?.has(ex.id)) continue;
        const cloze = buildCloze(ex.sentence, vocab.lemma, vocab.partOfSpeech);
        if (cloze) return { example: ex, sense, ...cloze };
      }
    }
    return null;
  }
}

// ----------------------------------------------------------------------
// Module-local helpers

// Deterministic weighted ordering via the Efraimidis–Spirakis key trick:
// each entry gets key = u^(1/weight) for a seeded u in (0,1); sorting by
// key descending yields a weighted sample-without-replacement order, so
// the first element is the weighted pick and the rest are the fallback
// order. Same seed → same order (reproducible / testable).
function weightedOrder(pool: WeightedType[], seed: string): QuestionType[] {
  return pool
    .map((entry, i) => {
      const u = hashUnit(`${seed}#${entry.type}#${i}`);
      return { type: entry.type, key: Math.pow(u, 1 / entry.weight) };
    })
    .sort((a, b) => b.key - a.key)
    .map((e) => e.type);
}

// Hashes a seed string to a deterministic value in the open interval
// (0,1). Never returns 0 (which would collapse any pow() to 0).
function hashUnit(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h << 5) - h + seed.charCodeAt(i);
    h |= 0;
  }
  return ((Math.abs(h) % 100000) + 1) / 100001;
}

function firstTranslationOfSense(
  sense: VocabularySense,
  lang: string,
): string | null {
  const t = (sense.translations ?? []).find((tr) => tr.language === lang);
  return t?.translation ?? null;
}

function findTrapTranslation(
  vocab: Vocabulary,
  excludeSenseId: string,
  lang: string,
): string | null {
  for (const sense of vocab.senses ?? []) {
    if (sense.id === excludeSenseId) continue;
    const t = (sense.translations ?? []).find((tr) => tr.language === lang);
    if (t) return t.translation;
  }
  return null;
}

function findExampleWithSpan(
  examples: VocabularyExample[],
  vocab: Vocabulary,
  excludeExampleIds?: Set<string>,
): { example: VocabularyExample; start: number; end: number } | null {
  for (let i = 0; i < examples.length; i++) {
    if (examples.length >= 3 && i === 0) continue;
    const ex = examples[i];
    if (excludeExampleIds?.has(ex.id)) continue;
    const span = findLemmaSpan(ex.sentence, vocab.lemma, vocab.partOfSpeech);
    if (span) return { example: ex, start: span.start, end: span.end };
  }
  if (examples.length === 2 && !excludeExampleIds?.has(examples[0].id)) {
    const span = findLemmaSpan(
      examples[0].sentence,
      vocab.lemma,
      vocab.partOfSpeech,
    );
    if (span) return { example: examples[0], start: span.start, end: span.end };
  }
  return null;
}
