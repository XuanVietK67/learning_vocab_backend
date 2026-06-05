import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { TopicResponseDto } from '@/topics/dto/topic-response.dto';
import { Topic } from '@/topics/entities/topic.entity';
import { VocabularyTopic } from '@/topics/entities/vocabulary-topic.entity';
import { AudioQueueProducer } from '@/vocabularies/audio/audio-queue.producer';
import { EnrichmentQueueProducer } from '@/vocabularies/enrichment/enrichment-queue.producer';
import { ImageQueueProducer } from '@/vocabularies/images/image-queue.producer';
import {
  CreateAdminExampleDto,
  UpdateAdminExampleDto,
} from '@/vocabularies/dto/admin-example.dto';
import { AdminSenseReorderDto } from '@/vocabularies/dto/admin-sense-reorder.dto';
import {
  CreateAdminSenseDto,
  UpdateAdminSenseDto,
} from '@/vocabularies/dto/admin-sense.dto';
import { AdminTopicsReplaceDto } from '@/vocabularies/dto/admin-topics-replace.dto';
import {
  CreateAdminTranslationDto,
  UpdateAdminTranslationDto,
} from '@/vocabularies/dto/admin-translation.dto';
import {
  AdminVocabularyQueryDto,
  AdminVocabularySortBy,
  SortDirection,
} from '@/vocabularies/dto/admin-vocabulary-query.dto';
import { PaginatedAdminVocabulariesResponseDto } from '@/vocabularies/dto/admin-vocabulary-response.dto';
import {
  BulkImportSummaryDto,
  BulkImportVocabulariesDto,
} from '@/vocabularies/dto/bulk-import-vocabularies.dto';
import {
  CreateSenseDto,
  CreateVocabularyDto,
} from '@/vocabularies/dto/create-vocabulary.dto';
import { UpdateVocabularyDto } from '@/vocabularies/dto/update-vocabulary.dto';
import { UserVocabularyQueryDto } from '@/vocabularies/dto/user-vocabulary-query.dto';
import { VocabularyQueryDto } from '@/vocabularies/dto/vocabulary-query.dto';
import {
  PaginatedVocabulariesResponseDto,
  VocabularyResponseDto,
  VocabularyExampleResponseDto,
  VocabularySenseResponseDto,
  VocabularyTranslationResponseDto,
} from '@/vocabularies/dto/vocabulary-response.dto';
import {
  BulkQuickCreateDto,
  BulkQuickCreateResponseDto,
} from '@/vocabularies/dto/bulk-quick-create.dto';
import { EnrichmentBatchResponseDto } from '@/vocabularies/dto/enrichment-batch-response.dto';
import { EnrichmentJobResponseDto } from '@/vocabularies/dto/enrichment-job-response.dto';
import { ExtractLemmasResponseDto } from '@/vocabularies/dto/extract-lemmas.dto';
import { QuickCreateVocabularyDto } from '@/vocabularies/dto/quick-create-vocabulary.dto';
import {
  extractCandidates,
  SourceKind,
} from '@/vocabularies/enrichment/import/lemma-extractor';
import { normalizeLemmas } from '@/vocabularies/enrichment/import/normalize';
import { ExtractMode } from '@/vocabularies/enrichment/import/tokenize';
import { VocabEnrichmentJobStatus } from '@/vocabularies/entities/vocab-enrichment-job-status.enum';
import { VocabEnrichmentJob } from '@/vocabularies/entities/vocab-enrichment-job.entity';
import { VocabularyExample } from '@/vocabularies/entities/vocabulary-example.entity';
import { VocabularySense } from '@/vocabularies/entities/vocabulary-sense.entity';
import { VocabularySource } from '@/vocabularies/entities/vocabulary-source.enum';
import { VocabularyTranslation } from '@/vocabularies/entities/vocabulary-translation.entity';
import { Visibility } from '@/vocabularies/entities/visibility.enum';
import { Vocabulary } from '@/vocabularies/entities/vocabulary.entity';

// Max candidate lemmas returned from a single extract (the admin reviews these).
const EXTRACT_CANDIDATE_CAP = 1000;
// Max lemmas enriched in one bulk submit (matches the bulk-import cap).
const BULK_QUICK_CREATE_MAX = 500;

interface UpsertOutcome {
  vocab: Vocabulary;
  created: boolean;
  sensesAdded: number;
  translationsAdded: number;
  examplesAdded: number;
  topicLinksAdded: number;
}

type Ownership =
  | { source: VocabularySource.SYSTEM }
  | { source: VocabularySource.USER; userId: string };

@Injectable()
export class VocabulariesService {
  constructor(
    @InjectRepository(Vocabulary)
    private readonly vocabRepo: Repository<Vocabulary>,
    @InjectRepository(VocabEnrichmentJob)
    private readonly enrichmentJobRepo: Repository<VocabEnrichmentJob>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly audioProducer: AudioQueueProducer,
    private readonly enrichmentProducer: EnrichmentQueueProducer,
    private readonly imageProducer: ImageQueueProducer,
  ) {}

  async findAll(
    query: VocabularyQueryDto,
  ): Promise<PaginatedVocabulariesResponseDto> {
    const { language, cefrLevel, topic, q, translationLang, page, limit } =
      query;

    const idQb = this.vocabRepo
      .createQueryBuilder('vocab')
      .select('vocab.id', 'id')
      .addSelect('vocab.frequency_rank', 'frequency_rank')
      .addSelect('vocab.lemma', 'lemma')
      .where('vocab.source = :source', { source: VocabularySource.SYSTEM })
      // Only published (approved) system words are public; drafts stay hidden.
      .andWhere('vocab.is_approved = true');

    if (language) idQb.andWhere('vocab.language = :language', { language });
    if (cefrLevel)
      idQb.andWhere('vocab.cefr_level = :cefrLevel', { cefrLevel });
    if (q) idQb.andWhere('vocab.lemma ILIKE :q', { q: `${q}%` });
    if (topic) {
      idQb
        .innerJoin('vocabulary_topics', 'vt', 'vt.vocabulary_id = vocab.id')
        .innerJoin('topics', 't', 't.id = vt.topic_id')
        .andWhere('t.slug = :topicSlug', { topicSlug: topic });
    }

    const total = await idQb.getCount();

    const rows = await idQb
      .orderBy('vocab.frequency_rank', 'ASC', 'NULLS LAST')
      .addOrderBy('vocab.lemma', 'ASC')
      .offset((page - 1) * limit)
      .limit(limit)
      .getRawMany<{ id: string }>();

    const ids = rows.map((r) => r.id);
    if (ids.length === 0) {
      return plainToInstance(
        PaginatedVocabulariesResponseDto,
        { data: [], page, limit, total },
        { excludeExtraneousValues: true },
      );
    }

    const hydrated = await this.hydrateVocabulariesByIds(ids, translationLang);
    const byId = new Map(hydrated.map((v) => [v.id, v]));
    const data = ids
      .map((id) => byId.get(id))
      .filter((v): v is Vocabulary => v !== undefined);

    return plainToInstance(
      PaginatedVocabulariesResponseDto,
      { data, page, limit, total },
      { excludeExtraneousValues: true },
    );
  }

  async findAllForAdmin(
    query: AdminVocabularyQueryDto,
  ): Promise<PaginatedAdminVocabulariesResponseDto> {
    const {
      language,
      cefrLevel,
      topic,
      q,
      source,
      isApproved,
      visibility,
      createdByUserId,
      translationLang,
      sortBy,
      sortDir,
      page,
      limit,
    } = query;

    const idQb = this.vocabRepo
      .createQueryBuilder('vocab')
      .select('vocab.id', 'id');

    if (language) idQb.andWhere('vocab.language = :language', { language });
    if (cefrLevel)
      idQb.andWhere('vocab.cefr_level = :cefrLevel', { cefrLevel });
    if (q) idQb.andWhere('vocab.lemma ILIKE :q', { q: `${q}%` });
    if (source) idQb.andWhere('vocab.source = :source', { source });
    if (isApproved !== undefined)
      idQb.andWhere('vocab.is_approved = :isApproved', { isApproved });
    if (visibility)
      idQb.andWhere('vocab.visibility = :visibility', { visibility });
    if (createdByUserId)
      idQb.andWhere('vocab.created_by_user_id = :createdByUserId', {
        createdByUserId,
      });
    if (topic) {
      idQb
        .innerJoin('vocabulary_topics', 'vt', 'vt.vocabulary_id = vocab.id')
        .innerJoin('topics', 't', 't.id = vt.topic_id')
        .andWhere('t.slug = :topicSlug', { topicSlug: topic });
    }

    const total = await idQb.getCount();

    const sortColumn =
      sortBy === AdminVocabularySortBy.FREQUENCY_RANK
        ? 'vocab.frequency_rank'
        : 'vocab.created_at';
    const sortOrder = sortDir === SortDirection.DESC ? 'DESC' : 'ASC';

    const rows = await idQb
      .orderBy(sortColumn, sortOrder, 'NULLS LAST')
      .addOrderBy('vocab.lemma', 'ASC')
      .offset((page - 1) * limit)
      .limit(limit)
      .getRawMany<{ id: string }>();

    const ids = rows.map((r) => r.id);
    if (ids.length === 0) {
      return plainToInstance(
        PaginatedAdminVocabulariesResponseDto,
        { data: [], page, limit, total },
        { excludeExtraneousValues: true },
      );
    }

    const hydrated = await this.hydrateVocabulariesByIds(ids, translationLang);
    const byId = new Map(hydrated.map((v) => [v.id, v]));
    const data = ids
      .map((id) => byId.get(id))
      .filter((v): v is Vocabulary => v !== undefined);

    // Surface image data at the vocab level for the admin list table. Senses
    // are ordered by sense_order ASC, so `imageUrl` is the first one carrying
    // an image, and `images` is every distinct sense image in that order. The
    // per-sense images stay available under senses[].imageUrl.
    for (const v of data) {
      const senseImages = (v.senses ?? [])
        .map((s) => s.imageUrl)
        .filter((url): url is string => Boolean(url));
      const images = [...new Set(senseImages)];
      (
        v as Vocabulary & { imageUrl: string | null; images: string[] }
      ).imageUrl = images[0] ?? null;
      (v as Vocabulary & { imageUrl: string | null; images: string[] }).images =
        images;
    }

    return plainToInstance(
      PaginatedAdminVocabulariesResponseDto,
      { data, page, limit, total },
      { excludeExtraneousValues: true },
    );
  }

  async findById(
    id: string,
    translationLang?: string,
  ): Promise<VocabularyResponseDto> {
    const [vocab] = await this.hydrateVocabulariesByIds([id], translationLang);
    if (!vocab) {
      throw new NotFoundException('vocabulary not found');
    }
    return plainToInstance(VocabularyResponseDto, vocab, {
      excludeExtraneousValues: true,
    });
  }

  // Public detail read: serves only published (approved) system words. Unlike
  // the internal findById, this hides quick-create drafts and non-system rows.
  async findPublicById(
    id: string,
    translationLang?: string,
  ): Promise<VocabularyResponseDto> {
    const [vocab] = await this.hydrateVocabulariesByIds([id], translationLang);
    if (
      !vocab ||
      vocab.source !== VocabularySource.SYSTEM ||
      !vocab.isApproved
    ) {
      throw new NotFoundException('vocabulary not found');
    }
    return plainToInstance(VocabularyResponseDto, vocab, {
      excludeExtraneousValues: true,
    });
  }

  async createSystemVocabulary(
    dto: CreateVocabularyDto,
  ): Promise<VocabularyResponseDto> {
    const existing = await this.vocabRepo.findOne({
      where: {
        language: dto.language,
        lemma: dto.lemma,
        partOfSpeech: dto.partOfSpeech,
        source: VocabularySource.SYSTEM,
      },
    });
    if (existing) {
      throw new ConflictException(
        `vocabulary already exists for (${dto.language}, ${dto.lemma}, ${dto.partOfSpeech}) — use bulk-import for upsert`,
      );
    }

    const outcome = await this.dataSource.transaction((manager) =>
      this.upsertVocabulary(manager, dto, { source: VocabularySource.SYSTEM }),
    );
    // Auto-generate audio in the background when the caller didn't supply one.
    // Enqueued after commit so the worker sees the committed row.
    if (!dto.audioUrl) {
      await this.audioProducer.enqueue(
        outcome.vocab.id,
        dto.lemma,
        dto.language,
      );
    }
    return this.findById(outcome.vocab.id);
  }

  // ---- Quick-create (lemma-only) + enrichment ----

  /**
   * Create a quick-create enrichment job from just a lemma (+ optional language,
   * default 'en'). A background worker fills the rest and lands one draft
   * vocabulary per part of speech. Returns immediately with the job for polling.
   * Idempotent per (language, lemma): an existing pending job is returned
   * instead of starting a duplicate.
   */
  async quickCreateVocabulary(
    dto: QuickCreateVocabularyDto,
    requestedByUserId: string,
  ): Promise<EnrichmentJobResponseDto> {
    const language = dto.language ?? 'en';
    const lemma = dto.lemma.trim();

    const existingJob = await this.enrichmentJobRepo.findOne({
      where: { language, lemma, status: VocabEnrichmentJobStatus.PENDING },
      order: { createdAt: 'DESC' },
    });
    if (existingJob) {
      return this.toEnrichmentJobResponse(existingJob);
    }

    const job = await this.enrichmentJobRepo.save(
      this.enrichmentJobRepo.create({
        language,
        lemma,
        translationLanguage: dto.translationLanguage ?? null,
        status: VocabEnrichmentJobStatus.PENDING,
        requestedByUserId,
      }),
    );
    await this.enrichmentProducer.enqueue(job.id);
    return this.toEnrichmentJobResponse(job);
  }

  async getEnrichmentJob(jobId: string): Promise<EnrichmentJobResponseDto> {
    const job = await this.enrichmentJobRepo.findOne({ where: { id: jobId } });
    if (!job) {
      throw new NotFoundException('enrichment job not found');
    }
    return this.toEnrichmentJobResponse(job);
  }

  // ---- Bulk quick-create from a list/file ----

  /**
   * Parse an uploaded file (or pasted text) into candidate lemmas for review.
   * Stateless: no jobs, no writes. Drops words already in the system catalog so
   * the admin doesn't re-enrich what already exists.
   */
  async extractLemmas(params: {
    kind: SourceKind;
    mode: ExtractMode;
    language: string;
    buffer?: Buffer;
    text?: string;
  }): Promise<ExtractLemmasResponseDto> {
    const { lemmas: raw, removedStopwords } = await extractCandidates({
      kind: params.kind,
      mode: params.mode,
      buffer: params.buffer,
      text: params.text,
    });

    const extracted = raw.length;
    const {
      lemmas: normalized,
      deduped,
      capped,
    } = normalizeLemmas(raw, EXTRACT_CANDIDATE_CAP);

    let alreadyInCatalog = 0;
    let lemmas = normalized;
    if (normalized.length > 0) {
      const existing = await this.vocabRepo.find({
        where: {
          language: params.language,
          lemma: In(normalized),
          source: VocabularySource.SYSTEM,
        },
        select: { lemma: true },
      });
      if (existing.length > 0) {
        const taken = new Set(existing.map((v) => v.lemma.toLowerCase()));
        lemmas = normalized.filter((l) => !taken.has(l.toLowerCase()));
        alreadyInCatalog = normalized.length - lemmas.length;
      }
    }

    return plainToInstance(
      ExtractLemmasResponseDto,
      {
        lemmas,
        stats: {
          extracted,
          deduped,
          removedStopwords,
          alreadyInCatalog,
          capped,
        },
      },
      { excludeExtraneousValues: true },
    );
  }

  /**
   * Create one enrichment job per confirmed lemma, grouped under a batch id.
   * Skips lemmas that already have a pending job or an existing system vocab, so
   * re-submitting a list is cheap. Reuses the single-lemma enrichment pipeline.
   */
  async bulkQuickCreateVocabulary(
    dto: BulkQuickCreateDto,
    requestedByUserId: string,
  ): Promise<BulkQuickCreateResponseDto> {
    const language = dto.language ?? 'en';
    const { lemmas } = normalizeLemmas(dto.lemmas, BULK_QUICK_CREATE_MAX);
    if (lemmas.length === 0) {
      return plainToInstance(BulkQuickCreateResponseDto, {
        batchId: null,
        accepted: 0,
        skipped: 0,
      });
    }

    // Validate the chosen topics once, up front: a bad slug fails the whole
    // submit with 400 rather than every background job dying silently.
    const topicSlugs = await this.validateTopicSlugs(dto.topics);

    const taken = await this.lemmasAlreadyHandled(language, lemmas);
    const toCreate = lemmas.filter((l) => !taken.has(l.toLowerCase()));
    const skipped = lemmas.length - toCreate.length;

    // Tag-on-skip: lemmas already present as system words won't get a job, but
    // they still join the chosen topic(s) so the admin's word list lands whole.
    if (topicSlugs.length > 0) {
      await this.tagExistingSystemVocabs(language, lemmas, topicSlugs);
    }

    if (toCreate.length === 0) {
      return plainToInstance(BulkQuickCreateResponseDto, {
        batchId: null,
        accepted: 0,
        skipped,
      });
    }

    const batchId = randomUUID();
    const jobs = await this.enrichmentJobRepo.save(
      toCreate.map((lemma) =>
        this.enrichmentJobRepo.create({
          language,
          lemma,
          translationLanguage: dto.translationLanguage ?? null,
          status: VocabEnrichmentJobStatus.PENDING,
          batchId,
          requestedByUserId,
          topicSlugs,
        }),
      ),
    );
    for (const job of jobs) {
      await this.enrichmentProducer.enqueue(job.id);
    }

    return plainToInstance(BulkQuickCreateResponseDto, {
      batchId,
      accepted: jobs.length,
      skipped,
    });
  }

  async getEnrichmentBatch(
    batchId: string,
  ): Promise<EnrichmentBatchResponseDto> {
    const jobs = await this.enrichmentJobRepo.find({ where: { batchId } });
    if (jobs.length === 0) {
      throw new NotFoundException('batch not found');
    }

    let pending = 0;
    let completed = 0;
    let failed = 0;
    const resultVocabularyIds: string[] = [];
    for (const job of jobs) {
      if (job.status === VocabEnrichmentJobStatus.PENDING) pending++;
      else if (job.status === VocabEnrichmentJobStatus.COMPLETED) completed++;
      else if (job.status === VocabEnrichmentJobStatus.FAILED) failed++;
      resultVocabularyIds.push(...(job.resultVocabularyIds ?? []));
    }

    return plainToInstance(EnrichmentBatchResponseDto, {
      batchId,
      total: jobs.length,
      pending,
      completed,
      failed,
      resultVocabularyIds,
    });
  }

  // Resolves and validates topic slugs for a bulk quick-create. Dedupes, and
  // throws 400 listing any slug that isn't in the catalog. Returns [] when no
  // topics were supplied.
  private async validateTopicSlugs(slugs?: string[]): Promise<string[]> {
    if (!slugs || slugs.length === 0) return [];
    const unique = [...new Set(slugs)];
    const found = await this.dataSource.getRepository(Topic).find({
      where: { slug: In(unique) },
      select: { slug: true },
    });
    const known = new Set(found.map((t) => t.slug));
    const unknown = unique.filter((s) => !known.has(s));
    if (unknown.length > 0) {
      throw new BadRequestException(
        `unknown topic slug(s): ${unknown.join(', ')}`,
      );
    }
    return unique;
  }

  // Links every existing system vocabulary for the submitted lemmas to the
  // chosen topics (idempotent). The `toCreate` lemmas have no system rows yet,
  // so this only touches the ones that would otherwise be skipped.
  private async tagExistingSystemVocabs(
    language: string,
    lemmas: string[],
    topicSlugs: string[],
  ): Promise<void> {
    const existing = await this.vocabRepo.find({
      where: { language, lemma: In(lemmas), source: VocabularySource.SYSTEM },
      select: { id: true },
    });
    if (existing.length === 0) return;
    await this.dataSource.transaction(async (manager) => {
      for (const v of existing) {
        await this.upsertTopicLinks(manager, v.id, topicSlugs);
      }
    });
  }

  // Lowercased set of lemmas that already have a pending enrichment job or an
  // existing system vocabulary (any part of speech) — the lemmas a bulk submit
  // should skip. Two IN queries rather than per-lemma lookups.
  private async lemmasAlreadyHandled(
    language: string,
    lemmas: string[],
  ): Promise<Set<string>> {
    const [pendingJobs, systemVocabs] = await Promise.all([
      this.enrichmentJobRepo.find({
        where: {
          language,
          lemma: In(lemmas),
          status: VocabEnrichmentJobStatus.PENDING,
        },
        select: { lemma: true },
      }),
      this.vocabRepo.find({
        where: {
          language,
          lemma: In(lemmas),
          source: VocabularySource.SYSTEM,
        },
        select: { lemma: true },
      }),
    ]);
    return new Set(
      [...pendingJobs, ...systemVocabs].map((r) => r.lemma.toLowerCase()),
    );
  }

  /**
   * Publish a draft system vocabulary: flip is_approved and trigger media
   * generation (audio if missing, image per sense without one). Idempotent —
   * approving an already-approved word just re-returns it after re-checking media.
   */
  async approveVocabulary(id: string): Promise<VocabularyResponseDto> {
    const vocab = await this.vocabRepo.findOne({
      where: { id, source: VocabularySource.SYSTEM },
      relations: { senses: true },
    });
    if (!vocab) {
      throw new NotFoundException('vocabulary not found');
    }

    if (!vocab.isApproved) {
      vocab.isApproved = true;
      await this.vocabRepo.save(vocab);
    }

    // Generate media for the published word. Both are enqueued post-save and
    // skip when a URL already exists, so re-approving is safe.
    if (!vocab.audioUrl) {
      await this.audioProducer.enqueue(vocab.id, vocab.lemma, vocab.language);
    }
    for (const sense of vocab.senses ?? []) {
      if (!sense.imageUrl) {
        await this.imageProducer.enqueue(sense.id, vocab.lemma, vocab.language);
      }
    }

    return this.findById(vocab.id);
  }

  private toEnrichmentJobResponse(
    job: VocabEnrichmentJob,
  ): EnrichmentJobResponseDto {
    return plainToInstance(EnrichmentJobResponseDto, job, {
      excludeExtraneousValues: true,
    });
  }

  async updateSystemVocabulary(
    id: string,
    dto: UpdateVocabularyDto,
  ): Promise<VocabularyResponseDto> {
    const vocab = await this.vocabRepo.findOne({
      where: { id, source: VocabularySource.SYSTEM },
    });
    if (!vocab) {
      throw new NotFoundException('vocabulary not found');
    }

    Object.assign(vocab, dto);
    await this.vocabRepo.save(vocab);
    return this.findById(vocab.id);
  }

  async deleteSystemVocabulary(id: string): Promise<void> {
    const result = await this.vocabRepo.delete({
      id,
      source: VocabularySource.SYSTEM,
    });
    if (result.affected === 0) {
      throw new NotFoundException('vocabulary not found');
    }
  }

  // ---- Granular admin edits on nested entities ----

  async addSense(
    vocabId: string,
    dto: CreateAdminSenseDto,
  ): Promise<VocabularySenseResponseDto> {
    return this.dataSource.transaction(async (manager) => {
      await this.assertVocabExists(manager, vocabId);
      const senseRepo = manager.getRepository(VocabularySense);

      const maxRow = await senseRepo
        .createQueryBuilder('s')
        .select('COALESCE(MAX(s.sense_order), 0)', 'max')
        .where('s.vocabulary_id = :vocabId', { vocabId })
        .getRawOne<{ max: string | number }>();
      const nextOrder = Number(maxRow?.max ?? 0) + 1;

      const sense = await senseRepo.save(
        senseRepo.create({
          vocabularyId: vocabId,
          senseOrder: nextOrder,
          gloss: dto.gloss ?? null,
          definition: dto.definition ?? null,
          imageUrl: dto.imageUrl ?? null,
          synonyms: dto.synonyms ?? [],
          antonyms: dto.antonyms ?? [],
        }),
      );

      if (dto.translations?.length) {
        await this.upsertSenseTranslations(manager, sense.id, dto.translations);
      }
      if (dto.examples?.length) {
        const exRepo = manager.getRepository(VocabularyExample);
        await exRepo.save(
          dto.examples.map((e) =>
            exRepo.create({
              senseId: sense.id,
              sentence: e.sentence,
              translation: e.translation ?? null,
              source: e.source ?? 'manual',
            }),
          ),
        );
      }

      return this.toSenseResponseDto(
        await this.findSenseWithChildren(manager, sense.id),
      );
    });
  }

  async updateSense(
    vocabId: string,
    senseId: string,
    dto: UpdateAdminSenseDto,
  ): Promise<VocabularySenseResponseDto> {
    return this.dataSource.transaction(async (manager) => {
      const sense = await this.assertSenseBelongsToVocab(
        manager,
        vocabId,
        senseId,
      );
      if (dto.gloss !== undefined) sense.gloss = dto.gloss;
      if (dto.definition !== undefined) sense.definition = dto.definition;
      if (dto.imageUrl !== undefined) sense.imageUrl = dto.imageUrl;
      if (dto.synonyms !== undefined) sense.synonyms = dto.synonyms;
      if (dto.antonyms !== undefined) sense.antonyms = dto.antonyms;
      await manager.getRepository(VocabularySense).save(sense);

      return this.toSenseResponseDto(
        await this.findSenseWithChildren(manager, senseId),
      );
    });
  }

  async deleteSense(vocabId: string, senseId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const sense = await this.assertSenseBelongsToVocab(
        manager,
        vocabId,
        senseId,
      );
      const senseRepo = manager.getRepository(VocabularySense);
      await senseRepo.delete({ id: senseId });
      // Compact remaining sense_orders so they stay contiguous 1..N.
      // Postgres checks UNIQUE (vocabulary_id, sense_order) at statement
      // boundary, not row-by-row, so a single bulk UPDATE is safe.
      await senseRepo
        .createQueryBuilder()
        .update()
        .set({ senseOrder: () => 'sense_order - 1' })
        .where('vocabulary_id = :vocabId', { vocabId })
        .andWhere('sense_order > :order', { order: sense.senseOrder })
        .execute();
    });
  }

  async reorderSenses(
    vocabId: string,
    dto: AdminSenseReorderDto,
  ): Promise<VocabularySenseResponseDto[]> {
    return this.dataSource.transaction(async (manager) => {
      await this.assertVocabExists(manager, vocabId);
      const senseRepo = manager.getRepository(VocabularySense);

      const existing = await senseRepo.find({
        where: { vocabularyId: vocabId },
        order: { senseOrder: 'ASC' },
      });
      const existingIds = new Set(existing.map((s) => s.id));
      const incomingIds = new Set(dto.senseIds);

      if (
        existingIds.size !== incomingIds.size ||
        existing.length !== dto.senseIds.length ||
        [...existingIds].some((id) => !incomingIds.has(id))
      ) {
        throw new BadRequestException(
          'senseIds must be a permutation of the current sense ids for this vocabulary',
        );
      }

      // Two-pass write to avoid colliding with UNIQUE (vocabulary_id, sense_order)
      // for any in-flight row state: drive all senses to negative orders, then
      // assign the new positive orders.
      await senseRepo
        .createQueryBuilder()
        .update()
        .set({ senseOrder: () => '-sense_order' })
        .where('vocabulary_id = :vocabId', { vocabId })
        .execute();

      for (let i = 0; i < dto.senseIds.length; i++) {
        await senseRepo.update({ id: dto.senseIds[i] }, { senseOrder: i + 1 });
      }

      const refreshed = await senseRepo.find({
        where: { vocabularyId: vocabId },
        order: { senseOrder: 'ASC' },
        relations: { translations: true, examples: true },
      });
      return refreshed.map((s) => this.toSenseResponseDto(s));
    });
  }

  async addTranslation(
    vocabId: string,
    senseId: string,
    dto: CreateAdminTranslationDto,
  ): Promise<VocabularyTranslationResponseDto> {
    return this.dataSource.transaction(async (manager) => {
      await this.assertSenseBelongsToVocab(manager, vocabId, senseId);
      const repo = manager.getRepository(VocabularyTranslation);

      const dup = await repo.findOne({
        where: {
          senseId,
          language: dto.language,
          translation: dto.translation,
        },
      });
      if (dup) {
        throw new ConflictException(
          `translation (${dto.language}, "${dto.translation}") already exists for this sense`,
        );
      }

      const saved = await repo.save(
        repo.create({
          senseId,
          language: dto.language,
          translation: dto.translation,
          note: dto.note ?? null,
          source: dto.source ?? 'manual',
        }),
      );
      return plainToInstance(VocabularyTranslationResponseDto, saved, {
        excludeExtraneousValues: true,
      });
    });
  }

  async updateTranslation(
    vocabId: string,
    senseId: string,
    translationId: string,
    dto: UpdateAdminTranslationDto,
  ): Promise<VocabularyTranslationResponseDto> {
    return this.dataSource.transaction(async (manager) => {
      await this.assertSenseBelongsToVocab(manager, vocabId, senseId);
      const repo = manager.getRepository(VocabularyTranslation);
      const tr = await repo.findOne({ where: { id: translationId, senseId } });
      if (!tr) {
        throw new NotFoundException('translation not found');
      }

      const nextLang = dto.language ?? tr.language;
      const nextText = dto.translation ?? tr.translation;
      if (nextLang !== tr.language || nextText !== tr.translation) {
        const dup = await repo.findOne({
          where: { senseId, language: nextLang, translation: nextText },
        });
        if (dup && dup.id !== tr.id) {
          throw new ConflictException(
            `translation (${nextLang}, "${nextText}") already exists for this sense`,
          );
        }
      }

      if (dto.language !== undefined) tr.language = dto.language;
      if (dto.translation !== undefined) tr.translation = dto.translation;
      if (dto.note !== undefined) tr.note = dto.note ?? null;
      if (dto.source !== undefined) tr.source = dto.source ?? null;

      const saved = await repo.save(tr);
      return plainToInstance(VocabularyTranslationResponseDto, saved, {
        excludeExtraneousValues: true,
      });
    });
  }

  async deleteTranslation(
    vocabId: string,
    senseId: string,
    translationId: string,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await this.assertSenseBelongsToVocab(manager, vocabId, senseId);
      const repo = manager.getRepository(VocabularyTranslation);
      const result = await repo.delete({ id: translationId, senseId });
      if (result.affected === 0) {
        throw new NotFoundException('translation not found');
      }
    });
  }

  async addExample(
    vocabId: string,
    senseId: string,
    dto: CreateAdminExampleDto,
  ): Promise<VocabularyExampleResponseDto> {
    return this.dataSource.transaction(async (manager) => {
      await this.assertSenseBelongsToVocab(manager, vocabId, senseId);
      const repo = manager.getRepository(VocabularyExample);
      const saved = await repo.save(
        repo.create({
          senseId,
          sentence: dto.sentence,
          translation: dto.translation ?? null,
          source: dto.source ?? 'manual',
        }),
      );
      return plainToInstance(VocabularyExampleResponseDto, saved, {
        excludeExtraneousValues: true,
      });
    });
  }

  async updateExample(
    vocabId: string,
    senseId: string,
    exampleId: string,
    dto: UpdateAdminExampleDto,
  ): Promise<VocabularyExampleResponseDto> {
    return this.dataSource.transaction(async (manager) => {
      await this.assertSenseBelongsToVocab(manager, vocabId, senseId);
      const repo = manager.getRepository(VocabularyExample);
      const ex = await repo.findOne({ where: { id: exampleId, senseId } });
      if (!ex) {
        throw new NotFoundException('example not found');
      }
      if (dto.sentence !== undefined) ex.sentence = dto.sentence;
      if (dto.translation !== undefined)
        ex.translation = dto.translation ?? null;
      if (dto.source !== undefined) ex.source = dto.source ?? null;

      const saved = await repo.save(ex);
      return plainToInstance(VocabularyExampleResponseDto, saved, {
        excludeExtraneousValues: true,
      });
    });
  }

  async deleteExample(
    vocabId: string,
    senseId: string,
    exampleId: string,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await this.assertSenseBelongsToVocab(manager, vocabId, senseId);
      const repo = manager.getRepository(VocabularyExample);
      const result = await repo.delete({ id: exampleId, senseId });
      if (result.affected === 0) {
        throw new NotFoundException('example not found');
      }
    });
  }

  async replaceTopics(
    vocabId: string,
    dto: AdminTopicsReplaceDto,
  ): Promise<TopicResponseDto[]> {
    return this.dataSource.transaction(async (manager) => {
      await this.assertVocabExists(manager, vocabId);
      const topicRepo = manager.getRepository(Topic);
      const linkRepo = manager.getRepository(VocabularyTopic);

      let resolvedTopics: Topic[] = [];
      if (dto.slugs.length > 0) {
        resolvedTopics = await topicRepo.find({
          where: { slug: In(dto.slugs) },
        });
        if (resolvedTopics.length !== new Set(dto.slugs).size) {
          const found = new Set(resolvedTopics.map((t) => t.slug));
          const missing = dto.slugs.filter((s) => !found.has(s));
          throw new BadRequestException(
            `unknown topic slug(s): ${missing.join(', ')}`,
          );
        }
      }

      const desiredIds = new Set(resolvedTopics.map((t) => t.id));
      const existing = await linkRepo.find({
        where: { vocabularyId: vocabId },
      });
      const existingIds = new Set(existing.map((l) => l.topicId));

      const toAdd = [...desiredIds].filter((id) => !existingIds.has(id));
      const toRemove = [...existingIds].filter((id) => !desiredIds.has(id));

      if (toRemove.length > 0) {
        await linkRepo.delete({
          vocabularyId: vocabId,
          topicId: In(toRemove),
        });
      }
      if (toAdd.length > 0) {
        await linkRepo.save(
          toAdd.map((topicId) =>
            linkRepo.create({ vocabularyId: vocabId, topicId }),
          ),
        );
      }

      return resolvedTopics
        .sort((a, b) => a.slug.localeCompare(b.slug))
        .map((t) =>
          plainToInstance(TopicResponseDto, t, {
            excludeExtraneousValues: true,
          }),
        );
    });
  }

  async bulkImportSystemVocabularies(
    dto: BulkImportVocabulariesDto,
  ): Promise<BulkImportSummaryDto> {
    return this.dataSource.transaction(async (manager) => {
      let inserted = 0;
      let updated = 0;
      let sensesAdded = 0;
      let translationsAdded = 0;
      let examplesAdded = 0;
      let topicLinksAdded = 0;

      for (const item of dto.items) {
        const r = await this.upsertVocabulary(manager, item, {
          source: VocabularySource.SYSTEM,
        });
        if (r.created) inserted++;
        else updated++;
        sensesAdded += r.sensesAdded;
        translationsAdded += r.translationsAdded;
        examplesAdded += r.examplesAdded;
        topicLinksAdded += r.topicLinksAdded;
      }

      return {
        upserted: dto.items.length,
        inserted,
        updated,
        sensesAdded,
        translationsAdded,
        examplesAdded,
        topicLinksAdded,
      };
    });
  }

  // ---- User-owned (UGC) vocabularies ----

  async createUserVocabulary(
    userId: string,
    dto: CreateVocabularyDto,
  ): Promise<VocabularyResponseDto> {
    const existing = await this.vocabRepo.findOne({
      where: {
        createdByUserId: userId,
        language: dto.language,
        lemma: dto.lemma,
        partOfSpeech: dto.partOfSpeech,
        source: VocabularySource.USER,
      },
    });
    if (existing) {
      throw new ConflictException(
        `you already have a vocabulary for (${dto.language}, ${dto.lemma}, ${dto.partOfSpeech})`,
      );
    }

    const outcome = await this.dataSource.transaction((manager) =>
      this.upsertVocabulary(manager, dto, {
        source: VocabularySource.USER,
        userId,
      }),
    );
    // Auto-generate audio in the background when the caller didn't supply one.
    // Enqueued after commit so the worker sees the committed row.
    if (!dto.audioUrl) {
      await this.audioProducer.enqueue(
        outcome.vocab.id,
        dto.lemma,
        dto.language,
      );
    }
    return this.findById(outcome.vocab.id);
  }

  async findMyVocabularies(
    userId: string,
    query: UserVocabularyQueryDto,
  ): Promise<PaginatedVocabulariesResponseDto> {
    const { language, q, translationLang, page, limit } = query;

    const baseQb = this.vocabRepo
      .createQueryBuilder('vocab')
      .where('vocab.source = :source', { source: VocabularySource.USER })
      .andWhere('vocab.created_by_user_id = :userId', { userId });

    if (language) baseQb.andWhere('vocab.language = :language', { language });
    if (q) baseQb.andWhere('vocab.lemma ILIKE :q', { q: `${q}%` });

    const total = await baseQb.getCount();

    const rows = await baseQb
      .clone()
      .select('vocab.id', 'id')
      .orderBy('vocab.created_at', 'DESC')
      .offset((page - 1) * limit)
      .limit(limit)
      .getRawMany<{ id: string }>();

    const ids = rows.map((r) => r.id);
    if (ids.length === 0) {
      return plainToInstance(
        PaginatedVocabulariesResponseDto,
        { data: [], page, limit, total },
        { excludeExtraneousValues: true },
      );
    }

    const hydrated = await this.hydrateVocabulariesByIds(ids, translationLang);
    const byId = new Map(hydrated.map((v) => [v.id, v]));
    const data = ids
      .map((id) => byId.get(id))
      .filter((v): v is Vocabulary => v !== undefined);

    return plainToInstance(
      PaginatedVocabulariesResponseDto,
      { data, page, limit, total },
      { excludeExtraneousValues: true },
    );
  }

  async findMyVocabularyById(
    userId: string,
    id: string,
    translationLang?: string,
  ): Promise<VocabularyResponseDto> {
    await this.assertOwnedByUser(userId, id);
    return this.findById(id, translationLang);
  }

  async updateUserVocabulary(
    userId: string,
    id: string,
    dto: UpdateVocabularyDto,
  ): Promise<VocabularyResponseDto> {
    const vocab = await this.assertOwnedByUser(userId, id);
    Object.assign(vocab, dto);
    await this.vocabRepo.save(vocab);
    return this.findById(vocab.id);
  }

  async deleteUserVocabulary(userId: string, id: string): Promise<void> {
    await this.assertOwnedByUser(userId, id);
    await this.vocabRepo.delete({ id });
  }

  // ---- Internal helpers ----

  private async hydrateVocabulariesByIds(
    ids: string[],
    translationLang?: string,
  ): Promise<Vocabulary[]> {
    const qb = this.vocabRepo
      .createQueryBuilder('vocab')
      .whereInIds(ids)
      .leftJoinAndSelect('vocab.senses', 'senses')
      .leftJoinAndSelect('senses.examples', 'examples')
      .leftJoinAndSelect('vocab.vocabularyTopics', 'vocabularyTopics')
      .leftJoinAndSelect('vocabularyTopics.topic', 'topic');

    if (translationLang) {
      qb.leftJoinAndSelect(
        'senses.translations',
        'translations',
        'translations.language = :translationLang',
        { translationLang },
      );
    } else {
      qb.leftJoinAndSelect('senses.translations', 'translations');
    }

    const vocabs = await qb.addOrderBy('senses.sense_order', 'ASC').getMany();

    for (const v of vocabs) {
      const topics = (v.vocabularyTopics ?? [])
        .map((vt) => vt.topic)
        .filter((t): t is Topic => t !== null && t !== undefined)
        .sort((a, b) => a.slug.localeCompare(b.slug));
      (v as Vocabulary & { topics: Topic[] }).topics = topics;
    }

    return vocabs;
  }

  private async assertOwnedByUser(
    userId: string,
    id: string,
  ): Promise<Vocabulary> {
    const vocab = await this.vocabRepo.findOne({ where: { id } });
    if (!vocab) {
      throw new NotFoundException('vocabulary not found');
    }
    if (
      vocab.source !== VocabularySource.USER ||
      vocab.createdByUserId !== userId
    ) {
      throw new ForbiddenException('not your vocabulary');
    }
    return vocab;
  }

  private async upsertVocabulary(
    manager: EntityManager,
    dto: CreateVocabularyDto,
    ownership: Ownership,
  ): Promise<UpsertOutcome> {
    const vocabRepo = manager.getRepository(Vocabulary);

    const ownershipFields =
      ownership.source === VocabularySource.SYSTEM
        ? {
            source: VocabularySource.SYSTEM,
            createdByUserId: null,
            visibility: Visibility.SYSTEM,
            isApproved: true,
          }
        : {
            source: VocabularySource.USER,
            createdByUserId: ownership.userId,
            visibility: Visibility.PRIVATE,
            isApproved: false,
          };

    const fields = {
      language: dto.language,
      lemma: dto.lemma,
      partOfSpeech: dto.partOfSpeech,
      ipa: dto.ipa ?? null,
      cefrLevel: dto.cefrLevel ?? null,
      frequencyRank: dto.frequencyRank ?? null,
      audioUrl: dto.audioUrl ?? null,
      ...ownershipFields,
    };

    const findWhere =
      ownership.source === VocabularySource.SYSTEM
        ? {
            language: dto.language,
            lemma: dto.lemma,
            partOfSpeech: dto.partOfSpeech,
            source: VocabularySource.SYSTEM,
          }
        : {
            language: dto.language,
            lemma: dto.lemma,
            partOfSpeech: dto.partOfSpeech,
            source: VocabularySource.USER,
            createdByUserId: ownership.userId,
          };

    let vocab = await vocabRepo.findOne({ where: findWhere });
    const created = !vocab;
    if (vocab) {
      Object.assign(vocab, fields);
    } else {
      vocab = vocabRepo.create(fields);
    }
    vocab = await vocabRepo.save(vocab);

    const senseSummary = await this.upsertSenses(manager, vocab.id, dto.senses);
    const topicLinksAdded = await this.upsertTopicLinks(
      manager,
      vocab.id,
      dto.topics,
    );

    return {
      vocab,
      created,
      sensesAdded: senseSummary.sensesAdded,
      translationsAdded: senseSummary.translationsAdded,
      examplesAdded: senseSummary.examplesAdded,
      topicLinksAdded,
    };
  }

  // Upserts senses by position: existing senses with the same sense_order are
  // patched in place; new positions are inserted. Existing translations for a
  // sense are matched by (language, translation); examples are append-only and
  // only inserted when the target sense had none beforehand (no natural key).
  private async upsertSenses(
    manager: EntityManager,
    vocabId: string,
    senses: CreateSenseDto[],
  ): Promise<{
    sensesAdded: number;
    translationsAdded: number;
    examplesAdded: number;
  }> {
    const senseRepo = manager.getRepository(VocabularySense);
    const existingSenses = await senseRepo.find({
      where: { vocabularyId: vocabId },
      order: { senseOrder: 'ASC' },
    });
    const byOrder = new Map(existingSenses.map((s) => [s.senseOrder, s]));

    let sensesAdded = 0;
    let translationsAdded = 0;
    let examplesAdded = 0;

    for (let i = 0; i < senses.length; i++) {
      const dto = senses[i];
      const senseOrder = i + 1;
      let sense = byOrder.get(senseOrder);
      if (sense) {
        sense.gloss = dto.gloss ?? sense.gloss;
        sense.definition = dto.definition ?? sense.definition;
        sense.imageUrl = dto.imageUrl ?? sense.imageUrl;
        sense.synonyms = dto.synonyms ?? sense.synonyms;
        sense.antonyms = dto.antonyms ?? sense.antonyms;
        await senseRepo.save(sense);
      } else {
        sense = await senseRepo.save(
          senseRepo.create({
            vocabularyId: vocabId,
            senseOrder,
            gloss: dto.gloss ?? null,
            definition: dto.definition ?? null,
            imageUrl: dto.imageUrl ?? null,
            synonyms: dto.synonyms ?? [],
            antonyms: dto.antonyms ?? [],
          }),
        );
        sensesAdded++;
      }

      translationsAdded += await this.upsertSenseTranslations(
        manager,
        sense.id,
        dto.translations,
      );
      examplesAdded += await this.upsertSenseExamples(
        manager,
        sense.id,
        dto.examples,
      );
    }

    return { sensesAdded, translationsAdded, examplesAdded };
  }

  private async upsertSenseTranslations(
    manager: EntityManager,
    senseId: string,
    translations: CreateSenseDto['translations'],
  ): Promise<number> {
    if (!translations || translations.length === 0) return 0;
    const repo = manager.getRepository(VocabularyTranslation);
    let added = 0;
    for (const tr of translations) {
      const exists = await repo.findOne({
        where: {
          senseId,
          language: tr.language,
          translation: tr.translation,
        },
      });
      if (!exists) {
        await repo.save(
          repo.create({
            senseId,
            language: tr.language,
            translation: tr.translation,
            note: tr.note ?? null,
            source: tr.source ?? 'manual',
          }),
        );
        added++;
      }
    }
    return added;
  }

  // Examples are skip-if-sense-has-any since they have no natural key.
  private async upsertSenseExamples(
    manager: EntityManager,
    senseId: string,
    examples: CreateSenseDto['examples'],
  ): Promise<number> {
    if (!examples || examples.length === 0) return 0;
    const repo = manager.getRepository(VocabularyExample);
    const existing = await repo.count({ where: { senseId } });
    if (existing > 0) return 0;
    const rows = examples.map((e) =>
      repo.create({
        senseId,
        sentence: e.sentence,
        translation: e.translation ?? null,
        source: e.source ?? 'manual',
      }),
    );
    await repo.save(rows);
    return rows.length;
  }

  private async assertVocabExists(
    manager: EntityManager,
    vocabId: string,
  ): Promise<void> {
    const exists = await manager
      .getRepository(Vocabulary)
      .exists({ where: { id: vocabId } });
    if (!exists) {
      throw new NotFoundException('vocabulary not found');
    }
  }

  private async assertSenseBelongsToVocab(
    manager: EntityManager,
    vocabId: string,
    senseId: string,
  ): Promise<VocabularySense> {
    const sense = await manager
      .getRepository(VocabularySense)
      .findOne({ where: { id: senseId, vocabularyId: vocabId } });
    if (!sense) {
      throw new NotFoundException('sense not found');
    }
    return sense;
  }

  private async findSenseWithChildren(
    manager: EntityManager,
    senseId: string,
  ): Promise<VocabularySense> {
    const sense = await manager.getRepository(VocabularySense).findOne({
      where: { id: senseId },
      relations: { translations: true, examples: true },
    });
    if (!sense) {
      throw new NotFoundException('sense not found');
    }
    return sense;
  }

  private toSenseResponseDto(
    sense: VocabularySense,
  ): VocabularySenseResponseDto {
    return plainToInstance(VocabularySenseResponseDto, sense, {
      excludeExtraneousValues: true,
    });
  }

  private async upsertTopicLinks(
    manager: EntityManager,
    vocabId: string,
    slugs: string[] | undefined,
  ): Promise<number> {
    if (!slugs || slugs.length === 0) return 0;
    const topicRepo = manager.getRepository(Topic);
    const vtRepo = manager.getRepository(VocabularyTopic);
    let added = 0;
    for (const slug of slugs) {
      const topic = await topicRepo.findOne({ where: { slug } });
      if (!topic) {
        throw new BadRequestException(`unknown topic slug: ${slug}`);
      }
      const link = await vtRepo.findOne({
        where: { vocabularyId: vocabId, topicId: topic.id },
      });
      if (!link) {
        await vtRepo.save(
          vtRepo.create({ vocabularyId: vocabId, topicId: topic.id }),
        );
        added++;
      }
    }
    return added;
  }
}
