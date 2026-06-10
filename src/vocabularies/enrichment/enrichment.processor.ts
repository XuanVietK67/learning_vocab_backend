import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { Repository } from 'typeorm';
import { ProficiencyLevel } from '@/users/entities/proficiency-level.enum';
import { EnrichmentStatus } from '@/vocabularies/entities/enrichment-status.enum';
import { PartOfSpeech } from '@/vocabularies/entities/part-of-speech.enum';
import { VocabEnrichmentJobStatus } from '@/vocabularies/entities/vocab-enrichment-job-status.enum';
import { VocabEnrichmentJob } from '@/vocabularies/entities/vocab-enrichment-job.entity';
import { VocabularySource } from '@/vocabularies/entities/vocabulary-source.enum';
import { Vocabulary } from '@/vocabularies/entities/vocabulary.entity';
import { Visibility } from '@/vocabularies/entities/visibility.enum';
import {
  DictionaryPosGroup,
  fetchDictionaryEntry,
} from '@/vocabularies/enrichment/dictionary-client';
import {
  ENRICHMENT_QUEUE,
  EnrichVocabularyJobData,
} from '@/vocabularies/enrichment/enrichment-queue.constants';
import {
  enrichFromScratch,
  GemmaClientOptions,
  generateExamples,
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
// exists, so concurrency + the limiter are read from env directly. Each job
// makes several Gemma calls (one per part of speech), so default concurrency is
// 1 and the limiter caps job starts under the Gemma free-tier RPM.
const CONCURRENCY = parseInt(
  process.env.ENRICHMENT_WORKER_CONCURRENCY ?? '1',
  10,
);
const RPM = parseInt(process.env.GEMMA_REQUESTS_PER_MINUTE ?? '15', 10);

const MAX_SENSES_PER_POS = 3;
const DICTIONARY_TIMEOUT_MS = 10_000;

interface DraftInput {
  partOfSpeech: PartOfSpeech;
  ipa: string | null;
  cefrLevel: ProficiencyLevel;
  senses: PersistSense[];
}

@Processor(ENRICHMENT_QUEUE, {
  concurrency: CONCURRENCY,
  limiter: { max: RPM, duration: 60_000 },
})
export class EnrichmentProcessor extends WorkerHost {
  private readonly logger = new Logger(EnrichmentProcessor.name);

  constructor(
    @InjectRepository(VocabEnrichmentJob)
    private readonly jobRepo: Repository<VocabEnrichmentJob>,
    @InjectRepository(Vocabulary)
    private readonly vocabRepo: Repository<Vocabulary>,
    private readonly persistence: VocabularyPersistenceService,
    private readonly audioProducer: AudioQueueProducer,
    private readonly membership: DeckMembershipService,
    private readonly config: ConfigService,
  ) {
    super();
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

  // Build draft inputs from the dictionary (English) plus Gemma, falling back to
  // Gemma-only when the dictionary has no entry or the language is non-English.
  private async prepareDrafts(
    lemma: string,
    language: string,
    translationLanguage: string | null,
  ): Promise<DraftInput[]> {
    const gemmaOpts = this.gemmaOptions();

    if (language === 'en') {
      const groups = await fetchDictionaryEntry(lemma, DICTIONARY_TIMEOUT_MS);
      if (groups) {
        return this.draftsFromDictionary(
          lemma,
          language,
          groups,
          gemmaOpts,
          translationLanguage,
        );
      }
    }
    return this.draftsFromScratch(
      lemma,
      language,
      gemmaOpts,
      translationLanguage,
    );
  }

  private async draftsFromDictionary(
    lemma: string,
    language: string,
    groups: DictionaryPosGroup[],
    gemmaOpts: GemmaClientOptions,
    translationLanguage: string | null,
  ): Promise<DraftInput[]> {
    const drafts: DraftInput[] = [];
    for (const group of groups) {
      const pos = mapPartOfSpeech(group.partOfSpeechRaw);
      if (!pos) continue;

      const capped = group.senses.slice(0, MAX_SENSES_PER_POS);
      const enriched = await generateExamples(
        {
          lemma,
          partOfSpeech: pos,
          language,
          senses: capped.map((s) => ({ definition: s.definition })),
          translationLanguage: translationLanguage ?? undefined,
        },
        gemmaOpts,
      );

      const senses: PersistSense[] = capped.map((dictSense, i) => {
        const examples = enriched.senses[i].examples.map((sentence) => ({
          sentence,
          source: 'gemma',
        }));
        // Keep the dictionary's own example sentence too, when present.
        if (dictSense.example) {
          examples.push({ sentence: dictSense.example, source: 'dictionary' });
        }
        return {
          gloss: enriched.senses[i].gloss || null,
          definition: dictSense.definition,
          synonyms: dictSense.synonyms,
          antonyms: dictSense.antonyms,
          examples,
          translations: this.buildTranslations(
            translationLanguage,
            enriched.senses[i].translation,
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
    gemmaOpts: GemmaClientOptions,
    translationLanguage: string | null,
  ): Promise<DraftInput[]> {
    const groups = await enrichFromScratch(
      lemma,
      language,
      gemmaOpts,
      translationLanguage ?? undefined,
    );
    return groups.map((group) => ({
      partOfSpeech: group.partOfSpeech,
      ipa: null,
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
      apiKey: this.config.getOrThrow<string>('gemma.apiKey'),
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
