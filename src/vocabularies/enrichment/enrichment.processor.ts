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
import {
  PersistSense,
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

    // May throw on dictionary/Gemma network or parse errors — let BullMQ retry.
    const drafts = await this.prepareDrafts(lemma, language);
    if (drafts.length === 0) {
      await this.markFailed(jobId, 'enrichment produced no usable content');
      return;
    }

    // Skip any part of speech that already has a system row (approved or a prior
    // draft): the partial unique index on (language, lemma, part_of_speech)
    // WHERE source='system' forbids a duplicate, and we never clobber an
    // existing word.
    const createdIds: string[] = [];
    for (const draft of drafts) {
      const exists = await this.vocabRepo.exists({
        where: {
          language,
          lemma,
          partOfSpeech: draft.partOfSpeech,
          source: VocabularySource.SYSTEM,
        },
      });
      if (exists) continue;

      const vocab = await this.persistence.createVocabulary({
        language,
        lemma,
        partOfSpeech: draft.partOfSpeech,
        ipa: draft.ipa,
        cefrLevel: draft.cefrLevel,
        source: VocabularySource.SYSTEM,
        visibility: Visibility.SYSTEM,
        isApproved: false,
        enrichmentStatus: EnrichmentStatus.ENRICHED,
        createdByUserId: null,
        senses: draft.senses,
      });
      createdIds.push(vocab.id);
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

  // Build draft inputs from the dictionary (English) plus Gemma, falling back to
  // Gemma-only when the dictionary has no entry or the language is non-English.
  private async prepareDrafts(
    lemma: string,
    language: string,
  ): Promise<DraftInput[]> {
    const gemmaOpts = this.gemmaOptions();

    if (language === 'en') {
      const groups = await fetchDictionaryEntry(lemma, DICTIONARY_TIMEOUT_MS);
      if (groups) {
        return this.draftsFromDictionary(lemma, language, groups, gemmaOpts);
      }
    }
    return this.draftsFromScratch(lemma, language, gemmaOpts);
  }

  private async draftsFromDictionary(
    lemma: string,
    language: string,
    groups: DictionaryPosGroup[],
    gemmaOpts: GemmaClientOptions,
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
  ): Promise<DraftInput[]> {
    const groups = await enrichFromScratch(lemma, language, gemmaOpts);
    return groups.map((group) => ({
      partOfSpeech: group.partOfSpeech,
      ipa: null,
      cefrLevel: group.cefr,
      senses: group.senses.map((s) => ({
        gloss: s.gloss || null,
        definition: s.definition,
        examples: s.examples.map((sentence) => ({ sentence, source: 'gemma' })),
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
