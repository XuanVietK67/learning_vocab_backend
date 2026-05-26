import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Topic } from '@/topics/entities/topic.entity';
import { VocabularyTopic } from '@/topics/entities/vocabulary-topic.entity';
import {
  BulkImportSummaryDto,
  BulkImportVocabulariesDto,
} from '@/vocabularies/dto/bulk-import-vocabularies.dto';
import {
  CreateExampleDto,
  CreateTranslationDto,
  CreateVocabularyDto,
} from '@/vocabularies/dto/create-vocabulary.dto';
import { UpdateVocabularyDto } from '@/vocabularies/dto/update-vocabulary.dto';
import { UserVocabularyQueryDto } from '@/vocabularies/dto/user-vocabulary-query.dto';
import { VocabularyQueryDto } from '@/vocabularies/dto/vocabulary-query.dto';
import {
  PaginatedVocabulariesResponseDto,
  VocabularyResponseDto,
} from '@/vocabularies/dto/vocabulary-response.dto';
import { VocabularyExample } from '@/vocabularies/entities/vocabulary-example.entity';
import { VocabularySource } from '@/vocabularies/entities/vocabulary-source.enum';
import { VocabularyTranslation } from '@/vocabularies/entities/vocabulary-translation.entity';
import { Visibility } from '@/vocabularies/entities/visibility.enum';
import { Vocabulary } from '@/vocabularies/entities/vocabulary.entity';

interface UpsertOutcome {
  vocab: Vocabulary;
  created: boolean;
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
    @InjectDataSource() private readonly dataSource: DataSource,
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
      .where('vocab.source = :source', { source: VocabularySource.SYSTEM });

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

    const hydrateQb = this.vocabRepo
      .createQueryBuilder('vocab')
      .whereInIds(ids);

    if (translationLang) {
      hydrateQb.leftJoinAndSelect(
        'vocab.translations',
        'translations',
        'translations.language = :translationLang',
        { translationLang },
      );
    } else {
      hydrateQb.leftJoinAndSelect('vocab.translations', 'translations');
    }

    const unordered = await hydrateQb
      .orderBy('vocab.frequency_rank', 'ASC', 'NULLS LAST')
      .addOrderBy('vocab.lemma', 'ASC')
      .getMany();

    const byId = new Map(unordered.map((v) => [v.id, v]));
    const data = ids
      .map((id) => byId.get(id))
      .filter((v): v is Vocabulary => v !== undefined);

    return plainToInstance(
      PaginatedVocabulariesResponseDto,
      { data, page, limit, total },
      { excludeExtraneousValues: true },
    );
  }

  async findById(
    id: string,
    translationLang?: string,
  ): Promise<VocabularyResponseDto> {
    const qb = this.vocabRepo
      .createQueryBuilder('vocab')
      .leftJoinAndSelect('vocab.examples', 'examples')
      .where('vocab.id = :id', { id });

    if (translationLang) {
      qb.leftJoinAndSelect(
        'vocab.translations',
        'translations',
        'translations.language = :translationLang',
        { translationLang },
      );
    } else {
      qb.leftJoinAndSelect('vocab.translations', 'translations');
    }

    const vocab = await qb.getOne();
    if (!vocab) {
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
    return this.findById(outcome.vocab.id);
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

  async bulkImportSystemVocabularies(
    dto: BulkImportVocabulariesDto,
  ): Promise<BulkImportSummaryDto> {
    return this.dataSource.transaction(async (manager) => {
      let inserted = 0;
      let updated = 0;
      let translationsAdded = 0;
      let examplesAdded = 0;
      let topicLinksAdded = 0;

      for (const item of dto.items) {
        const r = await this.upsertVocabulary(manager, item, {
          source: VocabularySource.SYSTEM,
        });
        if (r.created) inserted++;
        else updated++;
        translationsAdded += r.translationsAdded;
        examplesAdded += r.examplesAdded;
        topicLinksAdded += r.topicLinksAdded;
      }

      return {
        upserted: dto.items.length,
        inserted,
        updated,
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

    const hydrateQb = this.vocabRepo
      .createQueryBuilder('vocab')
      .whereInIds(ids);

    if (translationLang) {
      hydrateQb.leftJoinAndSelect(
        'vocab.translations',
        'translations',
        'translations.language = :translationLang',
        { translationLang },
      );
    } else {
      hydrateQb.leftJoinAndSelect('vocab.translations', 'translations');
    }

    const unordered = await hydrateQb
      .orderBy('vocab.created_at', 'DESC')
      .getMany();

    const byId = new Map(unordered.map((v) => [v.id, v]));
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
      imageUrl: dto.imageUrl ?? null,
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

    const translationsAdded = await this.upsertTranslations(
      manager,
      vocab.id,
      dto.translations,
    );
    const examplesAdded = await this.upsertExamples(
      manager,
      vocab.id,
      dto.examples,
    );
    const topicLinksAdded = await this.upsertTopicLinks(
      manager,
      vocab.id,
      dto.topics,
    );

    return {
      vocab,
      created,
      translationsAdded,
      examplesAdded,
      topicLinksAdded,
    };
  }

  private async upsertTranslations(
    manager: EntityManager,
    vocabId: string,
    translations: CreateTranslationDto[] | undefined,
  ): Promise<number> {
    if (!translations || translations.length === 0) return 0;
    const repo = manager.getRepository(VocabularyTranslation);
    let added = 0;
    for (const tr of translations) {
      const exists = await repo.findOne({
        where: {
          vocabularyId: vocabId,
          language: tr.language,
          translation: tr.translation,
        },
      });
      if (!exists) {
        await repo.save(
          repo.create({
            vocabularyId: vocabId,
            language: tr.language,
            translation: tr.translation,
            note: tr.note ?? null,
          }),
        );
        added++;
      }
    }
    return added;
  }

  // Examples are skip-if-vocab-has-any since they have no natural key.
  private async upsertExamples(
    manager: EntityManager,
    vocabId: string,
    examples: CreateExampleDto[] | undefined,
  ): Promise<number> {
    if (!examples || examples.length === 0) return 0;
    const repo = manager.getRepository(VocabularyExample);
    const existing = await repo.count({ where: { vocabularyId: vocabId } });
    if (existing > 0) return 0;
    const rows = examples.map((e) =>
      repo.create({
        vocabularyId: vocabId,
        sentence: e.sentence,
        translation: e.translation ?? null,
        source: e.source ?? 'manual',
      }),
    );
    await repo.save(rows);
    return rows.length;
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
