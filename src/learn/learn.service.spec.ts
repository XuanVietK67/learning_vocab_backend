import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import learnConfig from '@/config/learn.config';
import { AnswerGraderService } from '@/learn/answer-grader.service';
import { CreateSessionDto } from '@/learn/dto/create-session.dto';
import { LearnSessionMode } from '@/learn/enums/learn-session-mode.enum';
import { HmacSignerService } from '@/learn/hmac-signer.service';
import { LearnService } from '@/learn/learn.service';
import { QuestionBuilderService } from '@/learn/question-builder.service';
import { PickResult, VocabPickerService } from '@/learn/vocab-picker.service';
import { UserWordProgress } from '@/progress/entities/user-word-progress.entity';
import { ProgressService } from '@/progress/progress.service';
import { User } from '@/users/entities/user.entity';
import { Vocabulary } from '@/vocabularies/entities/vocabulary.entity';

const USER_ID = '11111111-1111-1111-1111-111111111111';

function emptyPick(emptyReason: PickResult['emptyReason']): PickResult {
  return { dueVocabIds: [], freshVocabIds: [], emptyReason };
}

function makeChainableQb() {
  const qb = {
    whereInIds: jest.fn(),
    leftJoinAndSelect: jest.fn(),
    addOrderBy: jest.fn(),
    getMany: jest.fn().mockResolvedValue([]),
  };
  qb.whereInIds.mockReturnValue(qb);
  qb.leftJoinAndSelect.mockReturnValue(qb);
  qb.addOrderBy.mockReturnValue(qb);
  return qb;
}

describe('LearnService — mode dispatch', () => {
  let service: LearnService;
  const picker = {
    pickDaily: jest.fn(),
    pickByTopic: jest.fn(),
    pickByDeck: jest.fn(),
    pickReview: jest.fn(),
  };
  const progressService = {
    enroll: jest.fn().mockResolvedValue({
      enrolled: 0,
      alreadyEnrolled: 0,
      unknownVocabularyIds: [],
    }),
    submitReview: jest.fn(),
    findNextDueAt: jest.fn().mockResolvedValue(null),
  };

  beforeEach(async () => {
    Object.values(picker).forEach((m) => m.mockReset());
    Object.values(progressService).forEach(
      (m) => typeof m.mockReset === 'function' && m.mockReset(),
    );
    progressService.enroll.mockResolvedValue({
      enrolled: 0,
      alreadyEnrolled: 0,
      unknownVocabularyIds: [],
    });
    progressService.findNextDueAt.mockResolvedValue(null);

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        LearnService,
        { provide: VocabPickerService, useValue: picker },
        { provide: ProgressService, useValue: progressService },
        {
          provide: QuestionBuilderService,
          useValue: { buildLadder: jest.fn() },
        },
        { provide: AnswerGraderService, useValue: {} },
        {
          provide: HmacSignerService,
          useValue: { issue: jest.fn(), verify: jest.fn() },
        },
        {
          provide: learnConfig.KEY,
          useValue: {
            hmacSecret: 'x',
            signatureTtlMs: 1800_000,
            defaultSessionLimit: 15,
            maxSessionLimit: 50,
          },
        },
        {
          provide: getRepositoryToken(Vocabulary),
          useValue: { createQueryBuilder: jest.fn(() => makeChainableQb()) },
        },
        {
          provide: getRepositoryToken(User),
          useValue: {
            findOne: jest.fn().mockResolvedValue({
              id: USER_ID,
              targetLanguage: 'en',
              proficiencyLevel: 'A2',
            }),
          },
        },
        {
          provide: getRepositoryToken(UserWordProgress),
          useValue: { find: jest.fn().mockResolvedValue([]) },
        },
      ],
    }).compile();

    service = mod.get(LearnService);
  });

  it('mode=daily → calls picker.pickDaily', async () => {
    picker.pickDaily.mockResolvedValue(emptyPick('no_more_at_level'));
    const dto: CreateSessionDto = { mode: LearnSessionMode.DAILY };
    const res = await service.createSession(USER_ID, dto);
    expect(picker.pickDaily).toHaveBeenCalledTimes(1);
    expect(res.mode).toBe(LearnSessionMode.DAILY);
    expect(res.items).toEqual([]);
    expect(res.emptyReason).toBe('no_more_at_level');
  });

  it('mode=topic → calls picker.pickByTopic with slug', async () => {
    picker.pickByTopic.mockResolvedValue(emptyPick('no_more_at_level'));
    const dto: CreateSessionDto = {
      mode: LearnSessionMode.TOPIC,
      topicSlug: 'food',
    };
    await service.createSession(USER_ID, dto);
    expect(picker.pickByTopic).toHaveBeenCalledWith(
      expect.objectContaining({ id: USER_ID }),
      'food',
      15,
    );
  });

  it('mode=deck → calls picker.pickByDeck with deckId', async () => {
    picker.pickByDeck.mockResolvedValue(emptyPick('deck_exhausted'));
    const dto: CreateSessionDto = {
      mode: LearnSessionMode.DECK,
      deckId: '22222222-2222-2222-2222-222222222222',
    };
    const res = await service.createSession(USER_ID, dto);
    expect(picker.pickByDeck).toHaveBeenCalledWith(
      expect.objectContaining({ id: USER_ID }),
      '22222222-2222-2222-2222-222222222222',
      15,
    );
    expect(res.emptyReason).toBe('deck_exhausted');
  });

  it('mode=review → calls picker.pickReview, never enrolls', async () => {
    picker.pickReview.mockResolvedValue(emptyPick('no_enrollment'));
    const dto: CreateSessionDto = { mode: LearnSessionMode.REVIEW };
    const res = await service.createSession(USER_ID, dto);
    expect(picker.pickReview).toHaveBeenCalledTimes(1);
    expect(progressService.enroll).not.toHaveBeenCalled();
    expect(res.enrolledNewlyCount).toBe(0);
    expect(res.emptyReason).toBe('no_enrollment');
  });

  it('auto-enrolls fresh picks for non-review modes', async () => {
    picker.pickDaily.mockResolvedValue({
      dueVocabIds: [],
      freshVocabIds: ['v1', 'v2', 'v3'],
      emptyReason: null,
    });
    progressService.enroll.mockResolvedValue({
      enrolled: 3,
      alreadyEnrolled: 0,
      unknownVocabularyIds: [],
    });
    const dto: CreateSessionDto = { mode: LearnSessionMode.DAILY };
    const res = await service.createSession(USER_ID, dto);
    expect(progressService.enroll).toHaveBeenCalledWith(USER_ID, {
      vocabularyIds: ['v1', 'v2', 'v3'],
    });
    expect(res.enrolledNewlyCount).toBe(3);
  });

  it('deck mode auto-enrolls fresh picks via deck context (membership, not ownership)', async () => {
    const deckId = '22222222-2222-2222-2222-222222222222';
    picker.pickByDeck.mockResolvedValue({
      dueVocabIds: [],
      freshVocabIds: ['v1', 'v2'],
      emptyReason: null,
    });
    progressService.enroll.mockResolvedValue({
      enrolled: 2,
      alreadyEnrolled: 0,
      unknownVocabularyIds: [],
    });
    const dto: CreateSessionDto = { mode: LearnSessionMode.DECK, deckId };
    const res = await service.createSession(USER_ID, dto);
    expect(progressService.enroll).toHaveBeenCalledWith(USER_ID, {
      deckId,
      vocabularyIds: ['v1', 'v2'],
    });
    expect(res.enrolledNewlyCount).toBe(2);
  });

  it('clamps limit between 1 and 50', async () => {
    picker.pickDaily.mockResolvedValue(emptyPick('no_more_at_level'));
    await service.createSession(USER_ID, {
      mode: LearnSessionMode.DAILY,
      limit: 999,
    });
    expect(picker.pickDaily).toHaveBeenCalledWith(expect.anything(), 50);

    await service.createSession(USER_ID, {
      mode: LearnSessionMode.DAILY,
      limit: 0,
    });
    expect(picker.pickDaily).toHaveBeenLastCalledWith(expect.anything(), 1);
  });

  it('throws NotFoundException when user does not exist', async () => {
    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        LearnService,
        { provide: VocabPickerService, useValue: picker },
        { provide: ProgressService, useValue: progressService },
        {
          provide: QuestionBuilderService,
          useValue: { buildLadder: jest.fn() },
        },
        { provide: AnswerGraderService, useValue: {} },
        { provide: HmacSignerService, useValue: {} },
        {
          provide: learnConfig.KEY,
          useValue: {
            hmacSecret: 'x',
            signatureTtlMs: 1800_000,
            defaultSessionLimit: 15,
            maxSessionLimit: 50,
          },
        },
        {
          provide: getRepositoryToken(Vocabulary),
          useValue: { createQueryBuilder: jest.fn(() => makeChainableQb()) },
        },
        {
          provide: getRepositoryToken(User),
          useValue: { findOne: jest.fn().mockResolvedValue(null) },
        },
        {
          provide: getRepositoryToken(UserWordProgress),
          useValue: { find: jest.fn().mockResolvedValue([]) },
        },
      ],
    }).compile();
    const svc = mod.get(LearnService);
    await expect(
      svc.createSession(USER_ID, { mode: LearnSessionMode.DAILY }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
