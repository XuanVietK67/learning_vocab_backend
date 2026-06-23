import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { Repository } from 'typeorm';
import { EnrichmentStatus } from '@/vocabularies/entities/enrichment-status.enum';
import { VocabEnrichmentJobStatus } from '@/vocabularies/entities/vocab-enrichment-job-status.enum';
import { VocabEnrichmentJob } from '@/vocabularies/entities/vocab-enrichment-job.entity';
import { VocabularySource } from '@/vocabularies/entities/vocabulary-source.enum';
import { Vocabulary } from '@/vocabularies/entities/vocabulary.entity';
import { Visibility } from '@/vocabularies/entities/visibility.enum';
import { EnrichmentCacheService } from '@/vocabularies/enrichment/enrichment-cache.service';
import { DraftInput } from '@/vocabularies/enrichment/enrichment-draft.types';
import {
  composeIpaFromWords,
  DictionaryPosGroup,
  fetchDictionaryEntry,
} from '@/vocabularies/enrichment/dictionary-client';
import {
  ENRICHMENT_QUEUE,
  EnrichVocabularyJobData,
} from '@/vocabularies/enrichment/enrichment-queue.constants';
import { GemmaBatcher } from '@/vocabularies/enrichment/gemma-batcher';
import {
  BatchExamplesWordInput,
  BatchExamplesWordResult,
  BatchScratchWordInput,
  generateBatchExamples,
  generateBatchScratch,
  GemmaClientOptions,
  ScratchPosGroup,
} from '@/vocabularies/enrichment/gemma-enricher';
import { mapPartOfSpeech } from '@/vocabularies/enrichment/pos-map';
import { DeckMembershipService } from '@/decks/deck-membership.service';
import { AudioQueueProducer } from '@/vocabularies/audio/audio-queue.producer';
import {
  PersistSense,
  PersistTranslation,
  VocabularyPersistenceService,
} from '@/vocabularies/vocabulary-persistence.service';

// Decorator options are evaluated at class-decoration time, before Nest's DI
// exists, so concurrency + the limiter are read from env directly. Concurrency
// defaults to the batch size so several per-word jobs run at once and coalesce
// into one Gemma call (see the batchers below). The limiter still caps job
// STARTS at the free-tier RPM, which is a safe upper bound on actual calls:
// batching only collapses starts into fewer calls, never more.
const CONCURRENCY = parseInt(
  process.env.ENRICHMENT_WORKER_CONCURRENCY ?? '5',
  10,
);
const RPM = parseInt(process.env.GEMMA_REQUESTS_PER_MINUTE ?? '15', 10);

// How many words share one Gemma call, and how long a partial batch waits for
// more words before flushing (so a lone quick-create isn't stuck behind a batch
// that never fills).
const BATCH_SIZE = parseInt(process.env.ENRICHMENT_BATCH_SIZE ?? '5', 10);
const BATCH_LINGER_MS = parseInt(
  process.env.ENRICHMENT_BATCH_LINGER_MS ?? '300',
  10,
);

const MAX_SENSES_PER_POS = 3;
const DICTIONARY_TIMEOUT_MS = 10_000;

// Base delay for the job's exponential retry backoff. The producer sets
// attempts + backoff:{type:'custom'} and BullMQ calls enrichmentBackoff for each
// retry delay. A Gemma 503 "high demand" spike can last minutes, so the default
// (~15s base, doubling) spreads ~5 attempts across a few minutes.
const RETRY_BASE_DELAY_MS = parseInt(
  process.env.ENRICHMENT_RETRY_DELAY_MS ?? '15000',
  10,
);

/**
 * Exponential backoff with full jitter: `base * 2^(attemptsMade-1)`, then a
 * random 50–100% of that. The jitter matters because one quick-import fans out
 * many per-lemma jobs that would otherwise retry in lockstep and hammer the same
 * overloaded Gemma endpoint together (thundering herd). Exported for testing.
 */
export function enrichmentBackoff(attemptsMade: number): number {
  const exp = RETRY_BASE_DELAY_MS * 2 ** Math.max(0, attemptsMade - 1);
  return Math.round(exp * (0.5 + Math.random() * 0.5));
}

@Processor(ENRICHMENT_QUEUE, {
  concurrency: CONCURRENCY,
  limiter: { max: RPM, duration: 60_000 },
  settings: {
    backoffStrategy: (attemptsMade) => enrichmentBackoff(attemptsMade),
  },
})
export class EnrichmentProcessor extends WorkerHost {
  private readonly logger = new Logger(EnrichmentProcessor.name);

  // One coalescer per call type: dictionary-assisted (examples for known senses)
  // and scratch (whole structure). Both bucket by `${language}:${t}` so only
  // compatible requests batch together.
  private readonly examplesBatcher: GemmaBatcher<
    BatchExamplesWordInput,
    BatchExamplesWordResult
  >;
  private readonly scratchBatcher: GemmaBatcher<
    BatchScratchWordInput,
    ScratchPosGroup[]
  >;

  constructor(
    @InjectRepository(VocabEnrichmentJob)
    private readonly jobRepo: Repository<VocabEnrichmentJob>,
    @InjectRepository(Vocabulary)
    private readonly vocabRepo: Repository<Vocabulary>,
    private readonly persistence: VocabularyPersistenceService,
    private readonly audioProducer: AudioQueueProducer,
    private readonly membership: DeckMembershipService,
    private readonly cache: EnrichmentCacheService,
    private readonly config: ConfigService,
  ) {
    super();
    const batcherOpts = { maxBatch: BATCH_SIZE, lingerMs: BATCH_LINGER_MS };
    this.examplesBatcher = new GemmaBatcher(
      (inputs) => generateBatchExamples(inputs, this.gemmaOptions()),
      batcherOpts,
    );
    this.scratchBatcher = new GemmaBatcher(
      (inputs) => generateBatchScratch(inputs, this.gemmaOptions()),
      batcherOpts,
    );
  }

  async process(job: Job<EnrichVocabularyJobData>): Promise<void> {
    const { jobId } = job.data;

    const jobRow = await this.jobRepo.findOne({ where: { id: jobId } });
    if (!jobRow) {
      this.logger.warn(`enrichment job ${jobId} no longer exists; skipping`);
      return;
    }
    // Idempotency: a previous run may already have completed (or failed) it.
    if (jobRow.status !== VocabEnrichmentJobStatus.PENDING) {
      return;
    }

    const { lemma, language } = jobRow;
    const translationLanguage = this.resolveTranslationLanguage(jobRow);

    // May throw on dictionary/Gemma network or parse errors — let BullMQ retry.
    const drafts = await this.prepareDrafts(
      lemma,
      language,
      translationLanguage,
    );
    if (drafts.length === 0) {
      await this.markFailed(jobId, 'enrichment produced no usable content');
      return;
    }

    // A job with owner_user_id produces a user-owned, private, auto-approved
    // word; otherwise it lands an unapproved system catalog draft. The dedup
    // check is scoped to match: a user only collides with their own words, an
    // admin job with the system catalog.
    const ownerUserId = jobRow.ownerUserId;
    const ownership = ownerUserId
      ? {
          source: VocabularySource.USER,
          visibility: Visibility.PRIVATE,
          isApproved: true,
          createdByUserId: ownerUserId,
        }
      : {
          source: VocabularySource.SYSTEM,
          visibility: Visibility.SYSTEM,
          isApproved: false,
          createdByUserId: null,
        };

    // Skip any part of speech that already exists for this owner: we never
    // clobber an existing word, and for system jobs the partial unique index on
    // (language, lemma, part_of_speech) WHERE source='system' forbids a duplicate.
    const createdIds: string[] = [];
    for (const draft of drafts) {
      const exists = await this.vocabRepo.exists({
        where: {
          language,
          lemma,
          partOfSpeech: draft.partOfSpeech,
          source: ownership.source,
          ...(ownerUserId ? { createdByUserId: ownerUserId } : {}),
        },
      });
      if (exists) continue;

      const vocab = await this.persistence.createVocabulary({
        language,
        lemma,
        partOfSpeech: draft.partOfSpeech,
        ipa: draft.ipa,
        cefrLevel: draft.cefrLevel,
        source: ownership.source,
        visibility: ownership.visibility,
        isApproved: ownership.isApproved,
        enrichmentStatus: EnrichmentStatus.ENRICHED,
        createdByUserId: ownership.createdByUserId,
        senses: draft.senses,
        topicSlugs: jobRow.topicSlugs,
      });
      createdIds.push(vocab.id);

      // User words are auto-approved, so generate audio now (admin drafts get it
      // at approve-time instead). Mirrors the manual createUserVocabulary path.
      if (ownerUserId) {
        await this.audioProducer.enqueue(vocab.id, lemma, language);
      }
    }

    // Bulk-import jobs carry a target deck: append the freshly created word(s)
    // to it once they exist. The owner of the job owns the deck and the words,
    // so membership accessibility passes trivially.
    if (jobRow.targetDeckId && ownerUserId && createdIds.length > 0) {
      await this.membership.appendMembersTx(
        jobRow.targetDeckId,
        createdIds,
        ownerUserId,
      );
    }

    await this.jobRepo.update(
      { id: jobId, status: VocabEnrichmentJobStatus.PENDING },
      {
        status: VocabEnrichmentJobStatus.COMPLETED,
        resultVocabularyIds: createdIds,
        error: null,
      },
    );
    this.logger.log(
      `enriched "${lemma}" (${language}): created ${createdIds.length} draft(s)`,
    );
  }

  // Target language for the per-sense translation, or null to skip it. Falls
  // back to the configured default when the job didn't specify one, and never
  // translates a word into its own language.
  private resolveTranslationLanguage(job: VocabEnrichmentJob): string | null {
    const target =
      job.translationLanguage ??
      this.config.get<string>('gemma.translationLanguage', 'vi');
    if (!target || target === job.language) return null;
    return target;
  }

  // Wrap a Gemma-produced translation as a single PersistTranslation, or omit it
  // when there is no target language or the model returned nothing.
  private buildTranslations(
    language: string | null,
    translation: string | undefined,
  ): PersistTranslation[] | undefined {
    if (!language || !translation) return undefined;
    return [{ language, translation, source: 'gemma' }];
  }

  // Cache key bucket so only same-language/same-translation requests batch.
  private batchKey(
    language: string,
    translationLanguage: string | null,
  ): string {
    return `${language}:${translationLanguage ?? ''}`;
  }

  // Cache-first: a hit replays the whole model+dictionary output with no network
  // call. On a miss, generate, then cache the result before persisting so even a
  // failed persist (retried) won't re-spend the model.
  private async prepareDrafts(
    lemma: string,
    language: string,
    translationLanguage: string | null,
  ): Promise<DraftInput[]> {
    const cached = await this.cache.get(language, lemma, translationLanguage);
    if (cached) {
      this.logger.debug(`enrichment cache hit for "${lemma}" (${language})`);
      return cached;
    }

    const drafts = await this.generateDrafts(
      lemma,
      language,
      translationLanguage,
    );
    if (drafts.length > 0) {
      await this.cache.put(
        language,
        lemma,
        translationLanguage,
        drafts,
        this.config.get<string>('gemma.model', 'unknown'),
      );
    }
    return drafts;
  }

  // Build draft inputs from the dictionary (English) plus Gemma, falling back to
  // Gemma-only when the dictionary has no entry or the language is non-English.
  private async generateDrafts(
    lemma: string,
    language: string,
    translationLanguage: string | null,
  ): Promise<DraftInput[]> {
    if (language === 'en') {
      const groups = await fetchDictionaryEntry(lemma, DICTIONARY_TIMEOUT_MS);
      if (groups) {
        return this.draftsFromDictionary(
          lemma,
          language,
          groups,
          translationLanguage,
        );
      }
    }
    return this.draftsFromScratch(lemma, language, translationLanguage);
  }

  private async draftsFromDictionary(
    lemma: string,
    language: string,
    groups: DictionaryPosGroup[],
    translationLanguage: string | null,
  ): Promise<DraftInput[]> {
    // Resolve POS + cap senses up front; one batched Gemma call covers them all.
    const inputGroups = groups
      .map((group) => {
        const pos = mapPartOfSpeech(group.partOfSpeechRaw);
        if (!pos) return null;
        return {
          group,
          pos,
          capped: group.senses.slice(0, MAX_SENSES_PER_POS),
        };
      })
      .filter((g): g is NonNullable<typeof g> => g !== null);
    if (inputGroups.length === 0) return [];

    const wordInput: BatchExamplesWordInput = {
      lemma,
      language,
      translationLanguage: translationLanguage ?? undefined,
      posGroups: inputGroups.map(({ pos, capped }) => ({
        partOfSpeech: pos,
        senses: capped.map((s) => ({ definition: s.definition })),
      })),
    };

    const enriched = await this.examplesBatcher.submit(
      this.batchKey(language, translationLanguage),
      wordInput,
    );
    // The parser keeps posGroups aligned to the request and guarantees enough
    // senses per group, so this lookup always resolves for a successful word.
    const sensesByPos = new Map(
      enriched.posGroups.map((g) => [g.partOfSpeech, g.senses]),
    );

    const drafts: DraftInput[] = [];
    for (const { group, pos, capped } of inputGroups) {
      const enrichedSenses = sensesByPos.get(pos);
      if (!enrichedSenses) continue;

      const senses: PersistSense[] = capped.map((dictSense, i) => {
        const examples = (enrichedSenses[i]?.examples ?? []).map(
          (sentence) => ({ sentence, source: 'gemma' }),
        );
        // Keep the dictionary's own example sentence too, when present.
        if (dictSense.example) {
          examples.push({ sentence: dictSense.example, source: 'dictionary' });
        }
        return {
          gloss: enrichedSenses[i]?.gloss || null,
          definition: dictSense.definition,
          synonyms: dictSense.synonyms,
          antonyms: dictSense.antonyms,
          examples,
          translations: this.buildTranslations(
            translationLanguage,
            enrichedSenses[i]?.translation,
          ),
        };
      });

      drafts.push({
        partOfSpeech: pos,
        ipa: group.ipa,
        cefrLevel: enriched.cefr,
        senses,
      });
    }
    return drafts;
  }

  private async draftsFromScratch(
    lemma: string,
    language: string,
    translationLanguage: string | null,
  ): Promise<DraftInput[]> {
    const groups = await this.scratchBatcher.submit(
      this.batchKey(language, translationLanguage),
      {
        lemma,
        language,
        translationLanguage: translationLanguage ?? undefined,
      },
    );

    // Hybrid IPA: the dictionary has no whole-lemma entry (that's why we're on
    // the scratch path), but for an English multi-word phrase we can still
    // compose IPA from per-word lookups. When that can't cover every word, fall
    // back to the best-effort IPA Gemma returned. A dictionary hiccup here must
    // not fail enrichment — it just degrades to the Gemma IPA.
    let composedIpa: string | null = null;
    if (language === 'en') {
      try {
        composedIpa = await composeIpaFromWords(lemma, DICTIONARY_TIMEOUT_MS);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`IPA composition failed for "${lemma}": ${msg}`);
      }
    }

    return groups.map((group) => ({
      partOfSpeech: group.partOfSpeech,
      ipa: composedIpa ?? group.ipa,
      cefrLevel: group.cefr,
      senses: group.senses.map((s) => ({
        gloss: s.gloss || null,
        definition: s.definition,
        examples: s.examples.map((sentence) => ({ sentence, source: 'gemma' })),
        translations: this.buildTranslations(
          translationLanguage,
          s.translation,
        ),
      })),
    }));
  }

  private gemmaOptions(): GemmaClientOptions {
    return {
      apiKeys: this.config.getOrThrow<string[]>('gemma.apiKeys'),
      baseUrl: this.config.getOrThrow<string>('gemma.baseUrl'),
      model: this.config.getOrThrow<string>('gemma.model'),
      timeoutMs: this.config.get<number>('gemma.timeoutMs', 30_000),
    };
  }

  // Fires after every failed attempt. Only persist `failed` once BullMQ has
  // exhausted its retries — earlier failures are transient (rate limit, network,
  // a one-off unparseable response) and will be retried with backoff.
  @OnWorkerEvent('failed')
  async onFailed(job: Job<EnrichVocabularyJobData>, err: Error): Promise<void> {
    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < maxAttempts) {
      this.logger.warn(
        `enrichment job ${job.data.jobId} failed ` +
          `(try ${job.attemptsMade}/${maxAttempts}): ${err.message}`,
      );
      return;
    }
    await this.markFailed(job.data.jobId, err.message);
    this.logger.error(
      `enrichment job ${job.data.jobId} gave up: ${err.message}`,
    );
  }

  private async markFailed(jobId: string, reason: string): Promise<void> {
    await this.jobRepo.update(
      { id: jobId, status: VocabEnrichmentJobStatus.PENDING },
      { status: VocabEnrichmentJobStatus.FAILED, error: reason.slice(0, 1000) },
    );
  }
}
