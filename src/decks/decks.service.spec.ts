import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { DeckMembershipService } from '@/decks/deck-membership.service';
import { Deck } from '@/decks/entities/deck.entity';
import { DeckVocabulary } from '@/decks/entities/deck-vocabulary.entity';
import { DecksService } from '@/decks/decks.service';
import { User } from '@/users/entities/user.entity';
import { Visibility } from '@/vocabularies/entities/visibility.enum';
import { Vocabulary } from '@/vocabularies/entities/vocabulary.entity';
import { VocabulariesService } from '@/vocabularies/vocabularies.service';

const DECK_ID = '22222222-2222-2222-2222-222222222222';
const USER_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_USER_ID = '99999999-9999-9999-9999-999999999999';

// Minimal stand-in for the deck-detail member query: loadDeckDetail only reads
// `.getMany()` off the chain, so every builder method returns the same object.
function emptyMemberQb() {
  const qb: Record<string, jest.Mock> = {
    leftJoinAndSelect: jest.fn(),
    where: jest.fn(),
    orderBy: jest.fn(),
    addOrderBy: jest.fn(),
    getMany: jest.fn().mockResolvedValue([]),
  };
  for (const key of Object.keys(qb)) {
    if (key !== 'getMany') qb[key].mockReturnValue(qb);
  }
  return qb;
}

describe('DecksService — visibility & clone', () => {
  let service: DecksService;
  const deckRepo = {
    findOne: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  const deckVocabRepo = { createQueryBuilder: jest.fn() };
  const userRepo = { findOne: jest.fn() };
  const vocabRepo = {};
  const dataSource = { transaction: jest.fn() };
  const membership = { appendMembers: jest.fn(), appendMembersTx: jest.fn() };
  const vocabulariesService = { bulkQuickCreateUserVocabulary: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        DecksService,
        { provide: getRepositoryToken(Deck), useValue: deckRepo },
        {
          provide: getRepositoryToken(DeckVocabulary),
          useValue: deckVocabRepo,
        },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(Vocabulary), useValue: vocabRepo },
        { provide: getDataSourceToken(), useValue: dataSource },
        { provide: DeckMembershipService, useValue: membership },
        { provide: VocabulariesService, useValue: vocabulariesService },
      ],
    }).compile();
    service = moduleRef.get(DecksService);
    deckVocabRepo.createQueryBuilder.mockImplementation(() => emptyMemberQb());
  });

  describe('findById (public detail read)', () => {
    it('returns a seeded (owner-less) deck', async () => {
      deckRepo.findOne.mockResolvedValue({
        id: DECK_ID,
        ownerId: null,
        visibility: Visibility.SYSTEM,
      });
      const res = await service.findById(DECK_ID);
      expect(res.id).toBe(DECK_ID);
    });

    it('returns a user deck published as public', async () => {
      deckRepo.findOne.mockResolvedValue({
        id: DECK_ID,
        ownerId: OTHER_USER_ID,
        visibility: Visibility.PUBLIC,
      });
      const res = await service.findById(DECK_ID);
      expect(res.id).toBe(DECK_ID);
    });

    it("hides another user's private deck behind a 404", async () => {
      deckRepo.findOne.mockResolvedValue({
        id: DECK_ID,
        ownerId: OTHER_USER_ID,
        visibility: Visibility.PRIVATE,
      });
      await expect(service.findById(DECK_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws when the deck does not exist', async () => {
      deckRepo.findOne.mockResolvedValue(null);
      await expect(service.findById(DECK_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('cloneDeck', () => {
    it("refuses to clone another user's private deck (404)", async () => {
      const manager = {
        getRepository: jest.fn().mockReturnValue({
          findOne: jest.fn().mockResolvedValue({
            id: DECK_ID,
            ownerId: OTHER_USER_ID,
            visibility: Visibility.PRIVATE,
          }),
        }),
      };
      dataSource.transaction.mockImplementation((cb: (m: unknown) => unknown) =>
        cb(manager),
      );

      await expect(service.cloneDeck(USER_ID, DECK_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('bulkImportToDeck', () => {
    it('asserts ownership then delegates to the bulk enrichment service', async () => {
      deckRepo.findOne.mockResolvedValue({ id: DECK_ID, ownerId: USER_ID });
      vocabulariesService.bulkQuickCreateUserVocabulary.mockResolvedValue({
        batchId: '55555555-5555-5555-5555-555555555555',
        accepted: 2,
        skipped: 0,
      });

      const res = await service.bulkImportToDeck(USER_ID, DECK_ID, {
        lemmas: ['resilient', 'tenacious'],
      });

      expect(
        vocabulariesService.bulkQuickCreateUserVocabulary,
      ).toHaveBeenCalledWith(USER_ID, DECK_ID, {
        lemmas: ['resilient', 'tenacious'],
      });
      expect(res.accepted).toBe(2);
    });

    it("rejects bulk-importing into another user's deck (403)", async () => {
      deckRepo.findOne.mockResolvedValue({
        id: DECK_ID,
        ownerId: OTHER_USER_ID,
      });

      await expect(
        service.bulkImportToDeck(USER_ID, DECK_ID, { lemmas: ['resilient'] }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(
        vocabulariesService.bulkQuickCreateUserVocabulary,
      ).not.toHaveBeenCalled();
    });
  });
});
