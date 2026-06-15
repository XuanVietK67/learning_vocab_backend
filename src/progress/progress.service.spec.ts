import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import learnConfig from '@/config/learn.config';
import { Deck } from '@/decks/entities/deck.entity';
import { DeckVocabulary } from '@/decks/entities/deck-vocabulary.entity';
import { UserWordProgress } from '@/progress/entities/user-word-progress.entity';
import { ProgressService } from '@/progress/progress.service';
import { User } from '@/users/entities/user.entity';
import { Visibility } from '@/vocabularies/entities/visibility.enum';
import { Vocabulary } from '@/vocabularies/entities/vocabulary.entity';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_ID = '99999999-9999-9999-9999-999999999999';
const DECK_ID = '22222222-2222-2222-2222-222222222222';

describe('ProgressService — enroll', () => {
  let service: ProgressService;

  const progressRepo = {
    find: jest.fn().mockResolvedValue([]),
    create: jest.fn((row: unknown) => row),
    save: jest.fn().mockResolvedValue(undefined),
  };
  const vocabQb = {
    select: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    getRawMany: jest.fn().mockResolvedValue([]),
  };
  vocabQb.select.mockReturnValue(vocabQb);
  vocabQb.where.mockReturnValue(vocabQb);
  vocabQb.andWhere.mockReturnValue(vocabQb);
  const vocabRepo = {
    createQueryBuilder: jest.fn(() => vocabQb),
  };

  // Deck + DeckVocabulary are reached through dataSource.getRepository(...).
  const deckRepo = { findOne: jest.fn() };
  const deckVocabRepo = { find: jest.fn() };
  const dataSource = {
    getRepository: jest.fn((entity: unknown) => {
      if (entity === Deck) return deckRepo;
      if (entity === DeckVocabulary) return deckVocabRepo;
      throw new Error('unexpected repository');
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    progressRepo.find.mockResolvedValue([]);
    progressRepo.create.mockImplementation((row: unknown) => row);
    progressRepo.save.mockResolvedValue(undefined);
    vocabQb.getRawMany.mockResolvedValue([]);

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        ProgressService,
        {
          provide: getRepositoryToken(UserWordProgress),
          useValue: progressRepo,
        },
        { provide: getRepositoryToken(Vocabulary), useValue: vocabRepo },
        { provide: getRepositoryToken(User), useValue: {} },
        { provide: getDataSourceToken(), useValue: dataSource },
        { provide: DataSource, useValue: dataSource },
        {
          provide: learnConfig.KEY,
          useValue: { learningStepsMinutes: [1, 10] },
        },
      ],
    }).compile();

    service = mod.get(ProgressService);
  });

  it('enrolls every member of an owned deck regardless of vocab ownership', async () => {
    deckRepo.findOne.mockResolvedValue({
      id: DECK_ID,
      ownerId: USER_ID,
      visibility: Visibility.PRIVATE,
    });
    // Members are owned by another author (cloned-by-reference deck).
    deckVocabRepo.find.mockResolvedValue([
      { vocabularyId: 'w1' },
      { vocabularyId: 'w2' },
    ]);

    const res = await service.enroll(USER_ID, { deckId: DECK_ID });

    expect(res.enrolled).toBe(2);
    expect(res.unknownVocabularyIds).toEqual([]);
    // No per-word ownership filter is applied on the deck path.
    expect(vocabRepo.createQueryBuilder).not.toHaveBeenCalled();
    expect(progressRepo.save).toHaveBeenCalledTimes(1);
  });

  it('restricts deck enrollment to the requested member ids (session fresh picks)', async () => {
    deckRepo.findOne.mockResolvedValue({
      id: DECK_ID,
      ownerId: USER_ID,
      visibility: Visibility.PRIVATE,
    });
    deckVocabRepo.find.mockResolvedValue([
      { vocabularyId: 'w1' },
      { vocabularyId: 'w2' },
      { vocabularyId: 'w3' },
    ]);

    const res = await service.enroll(USER_ID, {
      deckId: DECK_ID,
      // 'wX' is not a member → must be reported unknown, never enrolled.
      vocabularyIds: ['w2', 'wX'],
    });

    expect(res.enrolled).toBe(1);
    expect(res.unknownVocabularyIds).toEqual(['wX']);
  });

  it('rejects enrolling a deck the caller may not study', async () => {
    deckRepo.findOne.mockResolvedValue({
      id: DECK_ID,
      ownerId: OTHER_ID,
      visibility: Visibility.PRIVATE,
    });

    await expect(service.enroll(USER_ID, { deckId: DECK_ID })).rejects.toThrow(
      ForbiddenException,
    );
    expect(progressRepo.save).not.toHaveBeenCalled();
  });

  it('still rejects free-form ids that are not system or the caller-owned vocab', async () => {
    // vocab query returns nothing → both ids are someone else's private words.
    vocabQb.getRawMany.mockResolvedValue([]);

    const res = await service.enroll(USER_ID, { vocabularyIds: ['w1', 'w2'] });

    expect(res.enrolled).toBe(0);
    expect(res.unknownVocabularyIds).toEqual(['w1', 'w2']);
    expect(progressRepo.save).not.toHaveBeenCalled();
  });
});
