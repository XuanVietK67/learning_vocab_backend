import { Injectable } from '@nestjs/common';
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
import { ProgressStatus } from '@/progress/entities/progress-status.enum';
import { VocabularyExample } from '@/vocabularies/entities/vocabulary-example.entity';
import { VocabularySense } from '@/vocabularies/entities/vocabulary-sense.entity';
import { Vocabulary } from '@/vocabularies/entities/vocabulary.entity';

export interface BuildContext {
  vocab: Vocabulary;
  status: ProgressStatus;
  translationLang: string | null;
  daySeed: string;
}

export interface BuiltQuestion {
  type: QuestionType;
  exampleId: string;
  prompt: SessionItemPrompt;
}

@Injectable()
export class QuestionBuilderService {
  constructor(private readonly distractor: DistractorService) {}

  // Picks a question type appropriate for the card's SRS status and the
  // available data, then builds the matching prompt. Returns null if no
  // type can be built (e.g. no example contains a matchable lemma form).
  async build(ctx: BuildContext): Promise<BuiltQuestion | null> {
    const allowed = this.allowedTypes(
      ctx.vocab,
      ctx.status,
      ctx.translationLang,
    );
    if (allowed.length === 0) return null;
    const type = pickDeterministic(allowed, ctx.daySeed + ctx.vocab.id);

    const built = await this.tryBuild(type, ctx);
    if (built) return built;

    // Fallback: try other allowed types in order
    for (const alt of allowed) {
      if (alt === type) continue;
      const b = await this.tryBuild(alt, ctx);
      if (b) return b;
    }
    return null;
  }

  private allowedTypes(
    vocab: Vocabulary,
    status: ProgressStatus,
    translationLang: string | null,
  ): QuestionType[] {
    const hasMultipleSenses = (vocab.senses?.length ?? 0) >= 2;
    const hasAudio = !!vocab.audioUrl;
    const hasTranslationLang = !!translationLang;

    const types: QuestionType[] = [];

    if (status === ProgressStatus.NEW || status === ProgressStatus.LEARNING) {
      types.push(QuestionType.CLOZE_MCQ);
      if (hasTranslationLang) types.push(QuestionType.MEANING_IN_CONTEXT);
    } else if (status === ProgressStatus.REVIEW) {
      types.push(QuestionType.CLOZE_TYPING);
      if (hasTranslationLang) types.push(QuestionType.SENTENCE_BUILD);
    } else {
      // mastered
      if (hasTranslationLang) types.push(QuestionType.SENTENCE_BUILD);
      if (hasMultipleSenses && hasTranslationLang) {
        types.push(QuestionType.SENSE_DISAMBIGUATION);
      }
      if (types.length === 0) types.push(QuestionType.CLOZE_TYPING);
    }

    if (hasAudio) types.push(QuestionType.LISTENING_CLOZE);

    return types;
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
    const picked = this.pickExampleForCloze(ctx.vocab);
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
    const picked = this.pickExampleForCloze(ctx.vocab);
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
      const exampleWithSpan = findExampleWithSpan(examples, ctx.vocab);
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
    const picked = this.pickExampleForCloze(ctx.vocab);
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
  private pickExampleForCloze(vocab: Vocabulary): {
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
        const cloze = buildCloze(ex.sentence, vocab.lemma, vocab.partOfSpeech);
        if (cloze) {
          return { example: ex, sense, ...cloze };
        }
      }
      // If 2 examples and we skipped above, try index 0 as fallback
      if (examples.length === 2) {
        const ex = examples[0];
        const cloze = buildCloze(ex.sentence, vocab.lemma, vocab.partOfSpeech);
        if (cloze) return { example: ex, sense, ...cloze };
      }
    }
    return null;
  }
}

// ----------------------------------------------------------------------
// Module-local helpers

function pickDeterministic<T>(arr: T[], seed: string): T {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h << 5) - h + seed.charCodeAt(i);
    h |= 0;
  }
  return arr[Math.abs(h) % arr.length];
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
): { example: VocabularyExample; start: number; end: number } | null {
  for (let i = 0; i < examples.length; i++) {
    if (examples.length >= 3 && i === 0) continue;
    const ex = examples[i];
    const span = findLemmaSpan(ex.sentence, vocab.lemma, vocab.partOfSpeech);
    if (span) return { example: ex, start: span.start, end: span.end };
  }
  if (examples.length === 2) {
    const span = findLemmaSpan(
      examples[0].sentence,
      vocab.lemma,
      vocab.partOfSpeech,
    );
    if (span) return { example: examples[0], start: span.start, end: span.end };
  }
  return null;
}
