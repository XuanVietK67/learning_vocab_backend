import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import learnConfig from '@/config/learn.config';
import {
  ClozeMcqPrompt,
  ClozeTypingPrompt,
  DictationPrompt,
  FlashcardPrompt,
  FlashcardSenseView,
  ImageChoicePrompt,
  ListeningChoicePrompt,
  ListeningClozePrompt,
  MeaningInContextPrompt,
  PronunciationPrompt,
  SenseDisambiguationPrompt,
  SentenceBuildPrompt,
  SessionItemPrompt,
  TranslationFromWordPrompt,
  WordFromTranslationPrompt,
} from '@/learn/dto/session-item.dto';
import {
  buildCloze,
  deterministicShuffle,
  findLemmaSpan,
  tokenizeSentence,
} from '@/learn/cloze.util';
import { DistractorService } from '@/learn/distractor.service';
import { QuestionType } from '@/learn/enums/question-type.enum';
import {
  bandOf,
  eligibleTypesForStatus,
  isClozeFamily,
  ladderIndex,
} from '@/learn/question-bands';
import { ProgressStatus } from '@/progress/entities/progress-status.enum';
import { VocabularyExample } from '@/vocabularies/entities/vocabulary-example.entity';
import { VocabularySense } from '@/vocabularies/entities/vocabulary-sense.entity';
import { Vocabulary } from '@/vocabularies/entities/vocabulary.entity';

export interface BuildContext {
  vocab: Vocabulary;
  // The word's mastery stage. Decides which difficulty bands are in play:
  // NEW = the full ladder (incl. the flashcard), LEARNING/REVIEW = recall +
  // production, MASTERED = production only. See `question-bands.ts`.
  status: ProgressStatus;
  translationLang: string | null;
  // Skip examples whose IDs appear here. Optional — empty/absent means no
  // exclusions.
  excludeExampleIds?: Set<string>;
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

  // Builds the word's lesson: the ordered (easy→hard) list of questions for
  // its mastery stage. Walks the stage-eligible types from `question-bands`,
  // skipping any whose data can't build.
  //
  // Two caps keep a lesson short and varied now that there are many types per
  // band: (1) a per-band cap (`maxTypesPerBand`) samples at most N quiz types
  // from each band — chosen deterministically by vocab id, so different words
  // exercise different types instead of every lesson running all of them; the
  // FLASHCARD study step is always kept and is exempt from this cap. (2) the
  // cloze-family cap limits how many sentence-blanking questions appear so the
  // same example isn't blanked several steps in a row. May return an empty
  // array if no type is feasible.
  async buildLadder(ctx: BuildContext): Promise<BuiltQuestion[]> {
    const eligible = eligibleTypesForStatus(ctx.status); // ladder (band) order
    const perBandCap = this.cfg.maxTypesPerBand;
    const clozeCap = this.cfg.clozeFamilyCapPerLesson;
    const out: BuiltQuestion[] = [];
    let clozeCount = 0;

    // Bands appear ascending because LADDER is band-ascending.
    const bands = [...new Set(eligible.map(bandOf))];
    for (const band of bands) {
      const inBand = eligible.filter((t) => bandOf(t) === band);
      // FLASHCARD is the study/intro step: always attempted, never sampled out.
      // The rest are shuffled (deterministic by vocab id) so the band cap picks
      // a varied subset per word.
      const forced = inBand.filter((t) => ALWAYS_INCLUDE.has(t));
      const optional = deterministicShuffle(
        inBand.filter((t) => !ALWAYS_INCLUDE.has(t)),
        `band-${band}-${ctx.vocab.id}`,
      );

      const built: BuiltQuestion[] = [];
      let optionalBuilt = 0;
      for (const type of [...forced, ...optional]) {
        const isForced = ALWAYS_INCLUDE.has(type);
        if (!isForced && optionalBuilt >= perBandCap) continue;
        if (isClozeFamily(type) && clozeCount >= clozeCap) continue;
        const q = await this.tryBuild(type, ctx);
        if (!q) continue;
        built.push(q);
        if (isClozeFamily(type)) clozeCount++;
        if (!isForced) optionalBuilt++;
      }
      // Restore easy→hard order within the band (sampling shuffled it).
      built.sort((a, b) => ladderIndex(a.type) - ladderIndex(b.type));
      out.push(...built);
    }
    return out;
  }

  private async tryBuild(
    type: QuestionType,
    ctx: BuildContext,
  ): Promise<BuiltQuestion | null> {
    switch (type) {
      case QuestionType.FLASHCARD:
        return this.buildFlashcard(ctx);
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
      case QuestionType.WORD_FROM_TRANSLATION:
        return this.buildWordFromTranslation(ctx);
      case QuestionType.TRANSLATION_FROM_WORD:
        return this.buildTranslationFromWord(ctx);
      case QuestionType.LISTENING_CHOICE:
        return this.buildListeningChoice(ctx);
      case QuestionType.DICTATION:
        return this.buildDictation(ctx);
      case QuestionType.IMAGE_CHOICE:
        return this.buildImageChoice(ctx);
      case QuestionType.PRONUNCIATION:
        return this.buildPronunciation(ctx);
    }
  }

  // --------------------------------------------------------------------
  // Individual builders

  // Study card. Renders every sense (meaning + first example) plus
  // pronunciation and audio. Needs at least one example across the senses so
  // the lesson has a real exampleId to sign (the flashcard doesn't grade
  // against it); a word with no examples produces no questions at all today.
  private buildFlashcard(ctx: BuildContext): BuiltQuestion | null {
    const senses = ctx.vocab.senses ?? [];
    let exampleId: string | null = null;
    const views: FlashcardSenseView[] = [];
    for (const sense of senses) {
      const ex = (sense.examples ?? [])[0] ?? null;
      if (ex && !exampleId) exampleId = ex.id;
      const translation = ctx.translationLang
        ? firstTranslationOfSense(sense, ctx.translationLang)
        : ((sense.translations ?? [])[0]?.translation ?? null);
      views.push({
        gloss: sense.gloss,
        definition: sense.definition,
        translation,
        example: ex
          ? { sentence: ex.sentence, translation: ex.translation }
          : null,
        synonyms: sense.synonyms ?? [],
        antonyms: sense.antonyms ?? [],
      });
    }
    if (!exampleId) return null;

    const prompt: FlashcardPrompt = {
      type: QuestionType.FLASHCARD,
      lemma: ctx.vocab.lemma,
      ipa: ctx.vocab.ipa,
      partOfSpeech: ctx.vocab.partOfSpeech,
      audioUrl: ctx.vocab.audioUrl ?? null,
      senses: views,
    };
    return { type: QuestionType.FLASHCARD, exampleId, prompt };
  }

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

  // Show a translation, pick the lemma. The correct option is the lemma;
  // distractors are sibling lemmas. Needs a sense with a translation in the
  // target lang plus an example (for the signed exampleId).
  private async buildWordFromTranslation(
    ctx: BuildContext,
  ): Promise<BuiltQuestion | null> {
    if (!ctx.translationLang) return null;
    const found = firstSenseWithTranslationAndExample(
      ctx.vocab,
      ctx.translationLang,
    );
    if (!found) return null;
    const distractors = await this.distractor.pickLemmaDistractors(
      ctx.vocab,
      3,
    );
    if (distractors.length < 3) return null;
    const options = deterministicShuffle(
      [ctx.vocab.lemma, ...distractors],
      `wft-${found.exampleId}`,
    );
    const prompt: WordFromTranslationPrompt = {
      type: QuestionType.WORD_FROM_TRANSLATION,
      translation: found.translation,
      options,
    };
    return {
      type: QuestionType.WORD_FROM_TRANSLATION,
      exampleId: found.exampleId,
      prompt,
    };
  }

  // Show the bare lemma, pick its translation. Correct = the sense translation;
  // distractors are translations of sibling words. The signed exampleId belongs
  // to the sense that owns the correct translation so the grader re-derives it.
  private async buildTranslationFromWord(
    ctx: BuildContext,
  ): Promise<BuiltQuestion | null> {
    if (!ctx.translationLang) return null;
    const found = firstSenseWithTranslationAndExample(
      ctx.vocab,
      ctx.translationLang,
    );
    if (!found) return null;
    const distractors = await this.distractor.pickTranslationDistractors(
      ctx.vocab,
      ctx.translationLang,
      [found.translation],
      3,
    );
    if (distractors.length < 3) return null;
    const options = deterministicShuffle(
      [found.translation, ...distractors].slice(0, 4),
      `tfw-${found.exampleId}`,
    );
    const prompt: TranslationFromWordPrompt = {
      type: QuestionType.TRANSLATION_FROM_WORD,
      lemma: ctx.vocab.lemma,
      options,
    };
    return {
      type: QuestionType.TRANSLATION_FROM_WORD,
      exampleId: found.exampleId,
      prompt,
    };
  }

  // Play the word's audio, pick the lemma. Needs audio + an example (signed id).
  private async buildListeningChoice(
    ctx: BuildContext,
  ): Promise<BuiltQuestion | null> {
    if (!ctx.vocab.audioUrl) return null;
    const exampleId = firstExampleId(ctx.vocab);
    if (!exampleId) return null;
    const distractors = await this.distractor.pickLemmaDistractors(
      ctx.vocab,
      3,
    );
    if (distractors.length < 3) return null;
    const options = deterministicShuffle(
      [ctx.vocab.lemma, ...distractors],
      `lch-${ctx.vocab.id}`,
    );
    const prompt: ListeningChoicePrompt = {
      type: QuestionType.LISTENING_CHOICE,
      audioUrl: ctx.vocab.audioUrl,
      options,
    };
    return { type: QuestionType.LISTENING_CHOICE, exampleId, prompt };
  }

  // Play the word's audio, type the lemma. Needs audio + an example (signed id).
  private buildDictation(ctx: BuildContext): BuiltQuestion | null {
    if (!ctx.vocab.audioUrl) return null;
    const exampleId = firstExampleId(ctx.vocab);
    if (!exampleId) return null;
    const hint = ctx.translationLang
      ? firstVocabTranslation(ctx.vocab, ctx.translationLang)
      : null;
    const prompt: DictationPrompt = {
      type: QuestionType.DICTATION,
      audioUrl: ctx.vocab.audioUrl,
      hintTranslation: hint,
    };
    return { type: QuestionType.DICTATION, exampleId, prompt };
  }

  // Show a sense image, pick the lemma. Needs a sense with an image + an
  // example anywhere on the word (for the signed exampleId).
  private async buildImageChoice(
    ctx: BuildContext,
  ): Promise<BuiltQuestion | null> {
    const imageUrl = firstSenseImageUrl(ctx.vocab);
    if (!imageUrl) return null;
    const exampleId = firstExampleId(ctx.vocab);
    if (!exampleId) return null;
    const distractors = await this.distractor.pickLemmaDistractors(
      ctx.vocab,
      3,
    );
    if (distractors.length < 3) return null;
    const options = deterministicShuffle(
      [ctx.vocab.lemma, ...distractors],
      `img-${ctx.vocab.id}`,
    );
    const prompt: ImageChoicePrompt = {
      type: QuestionType.IMAGE_CHOICE,
      imageUrl,
      options,
    };
    return { type: QuestionType.IMAGE_CHOICE, exampleId, prompt };
  }

  // Speak the word; the client transcribes (STT) and submits the text. Only
  // needs an example for the signed exampleId; `audioUrl` is a reference the
  // learner can play to hear the target pronunciation.
  private buildPronunciation(ctx: BuildContext): BuiltQuestion | null {
    const exampleId = firstExampleId(ctx.vocab);
    if (!exampleId) return null;
    const prompt: PronunciationPrompt = {
      type: QuestionType.PRONUNCIATION,
      lemma: ctx.vocab.lemma,
      ipa: ctx.vocab.ipa,
      audioUrl: ctx.vocab.audioUrl ?? null,
    };
    return { type: QuestionType.PRONUNCIATION, exampleId, prompt };
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

// Types always kept in a lesson, exempt from the per-band sampling cap.
// FLASHCARD is the study/intro step for a brand-new word.
const ALWAYS_INCLUDE: ReadonlySet<QuestionType> = new Set([
  QuestionType.FLASHCARD,
]);

function firstTranslationOfSense(
  sense: VocabularySense,
  lang: string,
): string | null {
  const t = (sense.translations ?? []).find((tr) => tr.language === lang);
  return t?.translation ?? null;
}

// First example id anywhere on the word — used by types that don't grade
// against a sentence but still need a valid exampleId to sign.
function firstExampleId(vocab: Vocabulary): string | null {
  for (const sense of vocab.senses ?? []) {
    const ex = (sense.examples ?? [])[0];
    if (ex) return ex.id;
  }
  return null;
}

// First sense image url (per-sense) anywhere on the word.
function firstSenseImageUrl(vocab: Vocabulary): string | null {
  for (const sense of vocab.senses ?? []) {
    if (sense.imageUrl) return sense.imageUrl;
  }
  return null;
}

// First translation (in `lang`) anywhere on the word.
function firstVocabTranslation(vocab: Vocabulary, lang: string): string | null {
  for (const sense of vocab.senses ?? []) {
    const t = firstTranslationOfSense(sense, lang);
    if (t) return t;
  }
  return null;
}

// First sense that has both a translation in `lang` and an example, returning
// that example's id (for signing) and the translation (the correct answer for
// the translation↔lemma recognition pair).
function firstSenseWithTranslationAndExample(
  vocab: Vocabulary,
  lang: string,
): { exampleId: string; translation: string } | null {
  for (const sense of vocab.senses ?? []) {
    const translation = firstTranslationOfSense(sense, lang);
    const ex = (sense.examples ?? [])[0];
    if (translation && ex) return { exampleId: ex.id, translation };
  }
  return null;
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
