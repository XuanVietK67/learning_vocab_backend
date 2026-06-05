import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { Topic } from '@/topics/entities/topic.entity';
import { VocabularyTopic } from '@/topics/entities/vocabulary-topic.entity';
import { AudioQueueProducer } from '@/vocabularies/audio/audio-queue.producer';
import { EnrichmentQueueProducer } from '@/vocabularies/enrichment/enrichment-queue.producer';
import { VocabEnrichmentJob } from '@/vocabularies/entities/vocab-enrichment-job.entity';
import { Vocabulary } from '@/vocabularies/entities/vocabulary.entity';
import { ImageQueueProducer } from '@/vocabularies/images/image-queue.producer';
import { VocabulariesService } from '@/vocabularies/vocabularies.service';

const VOCAB_ID = '22222222-2222-2222-2222-222222222222';
const JOB_ID = '33333333-3333-3333-3333-333333333333';
const USER_ID = '11111111-1111-1111-1111-111111111111';
const BATCH_ID = '44444444-4444-4444-4444-444444444444';

function makeChainableQb(rows: unknown[]) {
  const qb = {
    whereInIds: jest.fn(),
    leftJoinAndSelect: jest.fn(),
    addOrderBy: jest.fn(),
    getMany: jest.fn().mockResolvedValue(rows),
  };
  qb.whereInIds.mockReturnValue(qb);
  qb.leftJoinAndSelect.mockReturnValue(qb);
  qb.addOrderBy.mockReturnValue(qb);
  return qb;
}

describe('VocabulariesService — quick-create & approve', () => {
  let service: VocabulariesService;
  const vocabRepo = {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  const enrichmentJobRepo = {
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };
  const dataSource = { transaction: jest.fn(), getRepository: jest.fn() };
  const audioProducer = { enqueue: jest.fn() };
  const enrichmentProducer = { enqueue: jest.fn() };
  const imageProducer = { enqueue: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        VocabulariesService,
        { provide: getRepositoryToken(Vocabulary), useValue: vocabRepo },
        {
          provide: getRepositoryToken(VocabEnrichmentJob),
          useValue: enrichmentJobRepo,
        },
        { provide: getDataSourceToken(), useValue: dataSource },
        { provide: AudioQueueProducer, useValue: audioProducer },
        { provide: EnrichmentQueueProducer, useValue: enrichmentProducer },
        { provide: ImageQueueProducer, useValue: imageProducer },
      ],
    }).compile();
    service = moduleRef.get(VocabulariesService);
  });

  describe('quickCreateVocabulary', () => {
    it('reuses an existing pending job without enqueueing again', async () => {
      enrichmentJobRepo.findOne.mockResolvedValue({
        id: JOB_ID,
        language: 'en',
        lemma: 'run',
        status: 'pending',
        resultVocabularyIds: [],
        error: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await service.quickCreateVocabulary(
        { lemma: 'run' },
        USER_ID,
      );

      expect(res.id).toBe(JOB_ID);
      expect(enrichmentJobRepo.save).not.toHaveBeenCalled();
      expect(enrichmentProducer.enqueue).not.toHaveBeenCalled();
    });

    it('creates a job (trimming lemma, defaulting language) and enqueues it', async () => {
      enrichmentJobRepo.findOne.mockResolvedValue(null);
      enrichmentJobRepo.create.mockImplementation((x: object) => x);
      enrichmentJobRepo.save.mockResolvedValue({
        id: JOB_ID,
        language: 'en',
        lemma: 'run',
        status: 'pending',
        resultVocabularyIds: [],
        error: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await service.quickCreateVocabulary(
        { lemma: '  run  ' },
        USER_ID,
      );

      expect(enrichmentJobRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ language: 'en', lemma: 'run' }),
      );
      expect(enrichmentProducer.enqueue).toHaveBeenCalledWith(JOB_ID);
      expect(res.status).toBe('pending');
    });
  });

  describe('approveVocabulary', () => {
    it('flips is_approved and enqueues audio + image for senses without media', async () => {
      const vocab = {
        id: VOCAB_ID,
        lemma: 'run',
        language: 'en',
        source: 'system',
        isApproved: false,
        audioUrl: null,
        senses: [
          { id: 'sense-1', imageUrl: null },
          { id: 'sense-2', imageUrl: 'https://cdn/x.jpg' },
        ],
      };
      vocabRepo.findOne.mockResolvedValue(vocab);
      vocabRepo.save.mockResolvedValue(vocab);
      vocabRepo.createQueryBuilder.mockReturnValue(
        makeChainableQb([{ ...vocab, vocabularyTopics: [] }]),
      );

      await service.approveVocabulary(VOCAB_ID);

      expect(vocab.isApproved).toBe(true);
      expect(vocabRepo.save).toHaveBeenCalled();
      expect(audioProducer.enqueue).toHaveBeenCalledWith(VOCAB_ID, 'run', 'en');
      expect(imageProducer.enqueue).toHaveBeenCalledTimes(1);
      expect(imageProducer.enqueue).toHaveBeenCalledWith(
        'sense-1',
        'run',
        'en',
      );
    });

    it('does not re-save or re-enqueue audio when already approved with media', async () => {
      const vocab = {
        id: VOCAB_ID,
        lemma: 'run',
        language: 'en',
        source: 'system',
        isApproved: true,
        audioUrl: 'https://cdn/a.mp3',
        senses: [],
      };
      vocabRepo.findOne.mockResolvedValue(vocab);
      vocabRepo.createQueryBuilder.mockReturnValue(
        makeChainableQb([{ ...vocab, vocabularyTopics: [] }]),
      );

      await service.approveVocabulary(VOCAB_ID);

      expect(vocabRepo.save).not.toHaveBeenCalled();
      expect(audioProducer.enqueue).not.toHaveBeenCalled();
      expect(imageProducer.enqueue).not.toHaveBeenCalled();
    });

    it('throws NotFound when the system vocabulary is missing', async () => {
      vocabRepo.findOne.mockResolvedValue(null);
      await expect(service.approveVocabulary(VOCAB_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('bulkQuickCreateVocabulary', () => {
    it('skips lemmas with a pending job or existing system vocab, enqueues the rest', async () => {
      enrichmentJobRepo.find.mockResolvedValue([{ lemma: 'run' }]); // pending
      vocabRepo.find.mockResolvedValue([{ lemma: 'jump' }]); // in catalog
      enrichmentJobRepo.create.mockImplementation((x: object) => x);
      enrichmentJobRepo.save.mockImplementation((rows: { lemma: string }[]) =>
        Promise.resolve(rows.map((r, i) => ({ ...r, id: `job-${i}` }))),
      );

      const res = await service.bulkQuickCreateVocabulary(
        { lemmas: ['run', 'jump', 'serendipity', 'ephemeral'] },
        USER_ID,
      );

      expect(res.accepted).toBe(2);
      expect(res.skipped).toBe(2);
      expect(res.batchId).toBeTruthy();
      expect(enrichmentProducer.enqueue).toHaveBeenCalledTimes(2);
      // All created jobs share one batchId.
      const calls = enrichmentJobRepo.create.mock.calls as Array<
        [{ batchId: string }]
      >;
      const batchIds = calls.map((c) => c[0].batchId);
      expect(new Set(batchIds).size).toBe(1);
    });

    it('returns a null batchId when every lemma is skipped', async () => {
      enrichmentJobRepo.find.mockResolvedValue([{ lemma: 'run' }]);
      vocabRepo.find.mockResolvedValue([]);

      const res = await service.bulkQuickCreateVocabulary(
        { lemmas: ['run'] },
        USER_ID,
      );

      expect(res.batchId).toBeNull();
      expect(res.accepted).toBe(0);
      expect(res.skipped).toBe(1);
      expect(enrichmentProducer.enqueue).not.toHaveBeenCalled();
    });

    it('rejects an unknown topic slug with 400', async () => {
      dataSource.getRepository.mockReturnValue({
        find: jest.fn().mockResolvedValue([{ slug: 'household' }]),
      });

      await expect(
        service.bulkQuickCreateVocabulary(
          { lemmas: ['lamp'], topics: ['household', 'made-up'] },
          USER_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(enrichmentJobRepo.save).not.toHaveBeenCalled();
    });

    it('carries the chosen topics through to every created job', async () => {
      dataSource.getRepository.mockReturnValue({
        find: jest.fn().mockResolvedValue([{ slug: 'household' }]),
      });
      enrichmentJobRepo.find.mockResolvedValue([]); // no pending jobs
      vocabRepo.find.mockResolvedValue([]); // nothing in catalog yet
      enrichmentJobRepo.create.mockImplementation((x: object) => x);
      enrichmentJobRepo.save.mockImplementation((rows: { lemma: string }[]) =>
        Promise.resolve(rows.map((r, i) => ({ ...r, id: `job-${i}` }))),
      );

      const res = await service.bulkQuickCreateVocabulary(
        { lemmas: ['lamp', 'sofa'], topics: ['household'] },
        USER_ID,
      );

      expect(res.accepted).toBe(2);
      const calls = enrichmentJobRepo.create.mock.calls as Array<
        [{ topicSlugs: string[] }]
      >;
      for (const [arg] of calls) {
        expect(arg.topicSlugs).toEqual(['household']);
      }
    });

    it('tag-on-skip: links existing system words to the topic in place', async () => {
      dataSource.getRepository.mockReturnValue({
        find: jest.fn().mockResolvedValue([{ slug: 'household' }]),
      });
      enrichmentJobRepo.find.mockResolvedValue([]); // no pending jobs
      // First find() (skip detection) sees 'lamp' already in the catalog;
      // second find() (tag-on-skip) returns its row id to link.
      vocabRepo.find
        .mockResolvedValueOnce([{ lemma: 'lamp' }])
        .mockResolvedValueOnce([{ id: VOCAB_ID }]);
      enrichmentJobRepo.create.mockImplementation((x: object) => x);
      enrichmentJobRepo.save.mockImplementation((rows: { lemma: string }[]) =>
        Promise.resolve(rows.map((r, i) => ({ ...r, id: `job-${i}` }))),
      );

      const topicTxRepo = {
        findOne: jest.fn().mockResolvedValue({ id: 't1' }),
      };
      const vtRepo = {
        findOne: jest.fn().mockResolvedValue(null),
        create: jest.fn((x: object) => x),
        save: jest.fn(),
      };
      const manager = {
        getRepository: jest.fn((entity: unknown) =>
          entity === Topic ? topicTxRepo : vtRepo,
        ),
      };
      dataSource.transaction.mockImplementation(
        (cb: (m: typeof manager) => unknown) => cb(manager),
      );

      const res = await service.bulkQuickCreateVocabulary(
        { lemmas: ['lamp', 'sofa'], topics: ['household'] },
        USER_ID,
      );

      // 'lamp' is skipped (already exists) but still tagged; 'sofa' is created.
      expect(res.accepted).toBe(1);
      expect(res.skipped).toBe(1);
      expect(manager.getRepository).toHaveBeenCalledWith(VocabularyTopic);
      expect(vtRepo.save).toHaveBeenCalledTimes(1);
    });
  });

  describe('getEnrichmentBatch', () => {
    it('aggregates job statuses and flattens result ids', async () => {
      enrichmentJobRepo.find.mockResolvedValue([
        { status: 'completed', resultVocabularyIds: ['v1', 'v2'] },
        { status: 'pending', resultVocabularyIds: [] },
        { status: 'failed', resultVocabularyIds: [] },
      ]);

      const res = await service.getEnrichmentBatch(BATCH_ID);

      expect(res.total).toBe(3);
      expect(res.completed).toBe(1);
      expect(res.pending).toBe(1);
      expect(res.failed).toBe(1);
      expect(res.resultVocabularyIds).toEqual(['v1', 'v2']);
    });

    it('throws NotFound when the batch has no jobs', async () => {
      enrichmentJobRepo.find.mockResolvedValue([]);
      await expect(service.getEnrichmentBatch(BATCH_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
