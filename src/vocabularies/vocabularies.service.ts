import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { Repository } from 'typeorm';
import { VocabularyQueryDto } from '@/vocabularies/dto/vocabulary-query.dto';
import {
  PaginatedVocabulariesResponseDto,
  VocabularyResponseDto,
} from '@/vocabularies/dto/vocabulary-response.dto';
import { VocabularySource } from '@/vocabularies/entities/vocabulary-source.enum';
import { Vocabulary } from '@/vocabularies/entities/vocabulary.entity';

@Injectable()
export class VocabulariesService {
  constructor(
    @InjectRepository(Vocabulary)
    private readonly vocabRepo: Repository<Vocabulary>,
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
}
