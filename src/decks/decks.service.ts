import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { DataSource, IsNull, Repository } from 'typeorm';
import { Deck } from '@/decks/entities/deck.entity';
import { DeckVocabulary } from '@/decks/entities/deck-vocabulary.entity';
import { DeckMembershipService } from '@/decks/deck-membership.service';
import { CreateDeckDto } from '@/decks/dto/create-deck.dto';
import { DeckQueryDto } from '@/decks/dto/deck-query.dto';
import {
  DeckMembershipDto,
  DeckMembershipSummaryDto,
} from '@/decks/dto/deck-membership.dto';
import {
  DeckDetailResponseDto,
  DeckSummaryResponseDto,
  PaginatedDecksResponseDto,
} from '@/decks/dto/deck-response.dto';
import { MyDecksQueryDto } from '@/decks/dto/my-decks-query.dto';
import { UpdateDeckDto } from '@/decks/dto/update-deck.dto';
import { User } from '@/users/entities/user.entity';
import { BulkDeckImportDto } from '@/vocabularies/dto/bulk-deck-import.dto';
import { BulkQuickCreateResponseDto } from '@/vocabularies/dto/bulk-quick-create.dto';
import { Visibility } from '@/vocabularies/entities/visibility.enum';
import { Vocabulary } from '@/vocabularies/entities/vocabulary.entity';
import { VocabulariesService } from '@/vocabularies/vocabularies.service';

@Injectable()
export class DecksService {
  constructor(
    @InjectRepository(Deck)
    private readonly deckRepo: Repository<Deck>,
    @InjectRepository(DeckVocabulary)
    private readonly deckVocabRepo: Repository<DeckVocabulary>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Vocabulary)
    private readonly vocabRepo: Repository<Vocabulary>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly membership: DeckMembershipService,
    private readonly vocabulariesService: VocabulariesService,
  ) {}

  async findAll(query: DeckQueryDto): Promise<PaginatedDecksResponseDto> {
    const { language, cefrLevel, page, limit } = query;

    const qb = this.deckRepo
      .createQueryBuilder('deck')
      .where('deck.owner_id IS NULL');

    if (language) qb.andWhere('deck.language = :language', { language });
    if (cefrLevel) qb.andWhere('deck.cefr_level = :cefrLevel', { cefrLevel });

    qb.orderBy('deck.language', 'ASC')
      .addOrderBy('deck.cefr_level', 'ASC', 'NULLS LAST')
      .addOrderBy('deck.name', 'ASC');

    const [decks, total] = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return plainToInstance(
      PaginatedDecksResponseDto,
      { data: decks, page, limit, total },
      { excludeExtraneousValues: true },
    );
  }

  // Public detail read: only seeded (owner-less) decks and published `public`
  // user decks are visible here. A user's `private` deck must never leak through
  // this unauthenticated endpoint — fetch those via GET /v1/me/decks/:id.
  async findById(
    id: string,
    translationLang?: string,
  ): Promise<DeckDetailResponseDto> {
    const deck = await this.deckRepo.findOne({ where: { id } });
    if (
      !deck ||
      (deck.ownerId !== null && deck.visibility !== Visibility.PUBLIC)
    ) {
      throw new NotFoundException('deck not found');
    }
    return this.loadDeckDetail(deck, translationLang);
  }

  // Community catalog: user-owned decks their authors published as `public`.
  async findPublic(query: DeckQueryDto): Promise<PaginatedDecksResponseDto> {
    const { language, cefrLevel, page, limit } = query;

    const qb = this.deckRepo
      .createQueryBuilder('deck')
      .where('deck.owner_id IS NOT NULL')
      .andWhere('deck.visibility = :visibility', {
        visibility: Visibility.PUBLIC,
      });

    if (language) qb.andWhere('deck.language = :language', { language });
    if (cefrLevel) qb.andWhere('deck.cefr_level = :cefrLevel', { cefrLevel });

    qb.orderBy('deck.created_at', 'DESC');

    const [decks, total] = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return plainToInstance(
      PaginatedDecksResponseDto,
      { data: decks, page, limit, total },
      { excludeExtraneousValues: true },
    );
  }

  async findSuggestedForUser(
    userId: string,
  ): Promise<DeckSummaryResponseDto[]> {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: { id: true, targetLanguage: true, proficiencyLevel: true },
    });
    if (!user || !user.targetLanguage || !user.proficiencyLevel) {
      return [];
    }

    const decks = await this.deckRepo.find({
      where: {
        ownerId: IsNull(),
        language: user.targetLanguage,
        cefrLevel: user.proficiencyLevel,
      },
      order: { name: 'ASC' },
    });

    return decks.map((d) =>
      plainToInstance(DeckSummaryResponseDto, d, {
        excludeExtraneousValues: true,
      }),
    );
  }

  // ---- Personal decks (UGC) ----

  async createUserDeck(
    userId: string,
    dto: CreateDeckDto,
  ): Promise<DeckDetailResponseDto> {
    const deck = await this.dataSource.transaction(async (manager) => {
      const deckRepo = manager.getRepository(Deck);
      const created = deckRepo.create({
        name: dto.name,
        description: dto.description ?? null,
        language: dto.language,
        cefrLevel: dto.cefrLevel ?? null,
        ownerId: userId,
        visibility: dto.visibility ?? Visibility.PRIVATE,
        vocabCount: 0,
      });
      const saved = await deckRepo.save(created);

      if (dto.vocabularyIds && dto.vocabularyIds.length > 0) {
        await this.membership.appendMembers(
          manager,
          saved.id,
          dto.vocabularyIds,
          userId,
        );
      }
      return saved;
    });

    // Re-fetch for an up-to-date vocabCount; use the owner-scoped loader since a
    // private deck is hidden from the public findById.
    const owned = await this.assertOwnedByUser(userId, deck.id);
    return this.loadDeckDetail(owned);
  }

  // Save a copy of a seeded or published-`public` deck into the caller's own
  // decks as a fresh `private` deck. Members are copied by reference (same
  // vocabulary rows), preserving order. Private decks owned by others are
  // reported as not-found rather than forbidden, so their existence stays hidden.
  async cloneDeck(
    userId: string,
    sourceDeckId: string,
  ): Promise<DeckDetailResponseDto> {
    const clone = await this.dataSource.transaction(async (manager) => {
      const deckRepo = manager.getRepository(Deck);
      const source = await deckRepo.findOne({ where: { id: sourceDeckId } });
      if (
        !source ||
        (source.ownerId !== null && source.visibility !== Visibility.PUBLIC)
      ) {
        throw new NotFoundException('deck not found');
      }

      const created = await deckRepo.save(
        deckRepo.create({
          name: source.name,
          description: source.description,
          language: source.language,
          cefrLevel: source.cefrLevel,
          ownerId: userId,
          visibility: Visibility.PRIVATE,
          vocabCount: 0,
        }),
      );

      const dvRepo = manager.getRepository(DeckVocabulary);
      const members = await dvRepo.find({
        where: { deckId: sourceDeckId },
        order: { position: 'ASC' },
      });
      if (members.length > 0) {
        await dvRepo.save(
          members.map((m) =>
            dvRepo.create({
              deckId: created.id,
              vocabularyId: m.vocabularyId,
              position: m.position,
            }),
          ),
        );
        await deckRepo.update(
          { id: created.id },
          { vocabCount: members.length },
        );
      }

      return created;
    });

    const owned = await this.assertOwnedByUser(userId, clone.id);
    return this.loadDeckDetail(owned);
  }

  async findMyDecks(
    userId: string,
    query: MyDecksQueryDto,
  ): Promise<PaginatedDecksResponseDto> {
    const { language, cefrLevel, page, limit } = query;

    const qb = this.deckRepo
      .createQueryBuilder('deck')
      .where('deck.owner_id = :userId', { userId });

    if (language) qb.andWhere('deck.language = :language', { language });
    if (cefrLevel) qb.andWhere('deck.cefr_level = :cefrLevel', { cefrLevel });

    qb.orderBy('deck.created_at', 'DESC');

    const [decks, total] = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return plainToInstance(
      PaginatedDecksResponseDto,
      { data: decks, page, limit, total },
      { excludeExtraneousValues: true },
    );
  }

  async findMyDeckById(
    userId: string,
    id: string,
    translationLang?: string,
  ): Promise<DeckDetailResponseDto> {
    const deck = await this.assertOwnedByUser(userId, id);
    return this.loadDeckDetail(deck, translationLang);
  }

  async updateUserDeck(
    userId: string,
    id: string,
    dto: UpdateDeckDto,
  ): Promise<DeckDetailResponseDto> {
    const deck = await this.assertOwnedByUser(userId, id);
    Object.assign(deck, dto);
    await this.deckRepo.save(deck);
    return this.loadDeckDetail(deck);
  }

  async deleteUserDeck(userId: string, id: string): Promise<void> {
    await this.assertOwnedByUser(userId, id);
    await this.deckRepo.delete({ id });
  }

  async addVocabulariesToUserDeck(
    userId: string,
    deckId: string,
    dto: DeckMembershipDto,
  ): Promise<DeckMembershipSummaryDto> {
    await this.assertOwnedByUser(userId, deckId);
    return this.dataSource.transaction((manager) =>
      this.membership.appendMembers(manager, deckId, dto.vocabularyIds, userId),
    );
  }

  // Bulk-import words into one of the caller's decks from a list of lemmas.
  // Each lemma is enriched into the caller's own word(s) by the worker, which
  // then appends them to this deck (target_deck_id on the job). Returns the
  // batch handle to poll; the deck fills in as jobs complete.
  async bulkImportToDeck(
    userId: string,
    deckId: string,
    dto: BulkDeckImportDto,
  ): Promise<BulkQuickCreateResponseDto> {
    await this.assertOwnedByUser(userId, deckId);
    return this.vocabulariesService.bulkQuickCreateUserVocabulary(
      userId,
      deckId,
      dto,
    );
  }

  async removeVocabularyFromUserDeck(
    userId: string,
    deckId: string,
    vocabularyId: string,
  ): Promise<void> {
    await this.assertOwnedByUser(userId, deckId);
    await this.dataSource.transaction(async (manager) => {
      const dvRepo = manager.getRepository(DeckVocabulary);
      const deckRepo = manager.getRepository(Deck);

      const result = await dvRepo.delete({ deckId, vocabularyId });
      if (result.affected === 0) {
        throw new NotFoundException('vocabulary not in deck');
      }
      await deckRepo.decrement({ id: deckId }, 'vocabCount', 1);
    });
  }

  // ---- Internal ----

  private async assertOwnedByUser(
    userId: string,
    deckId: string,
  ): Promise<Deck> {
    const deck = await this.deckRepo.findOne({ where: { id: deckId } });
    if (!deck) {
      throw new NotFoundException('deck not found');
    }
    if (deck.ownerId !== userId) {
      throw new ForbiddenException('not your deck');
    }
    return deck;
  }

  private async loadDeckDetail(
    deck: Deck,
    translationLang?: string,
  ): Promise<DeckDetailResponseDto> {
    const dvQb = this.deckVocabRepo
      .createQueryBuilder('dv')
      .leftJoinAndSelect('dv.vocabulary', 'vocab')
      .leftJoinAndSelect('vocab.senses', 'senses')
      .leftJoinAndSelect('senses.examples', 'examples');

    if (translationLang) {
      dvQb.leftJoinAndSelect(
        'senses.translations',
        'translations',
        'translations.language = :translationLang',
        { translationLang },
      );
    } else {
      dvQb.leftJoinAndSelect('senses.translations', 'translations');
    }

    const members = await dvQb
      .where('dv.deck_id = :deckId', { deckId: deck.id })
      .orderBy('dv.position', 'ASC')
      .addOrderBy('senses.sense_order', 'ASC')
      .getMany();

    const vocabularies = members.map((m) => m.vocabulary);
    return plainToInstance(
      DeckDetailResponseDto,
      { ...deck, vocabularies },
      { excludeExtraneousValues: true },
    );
  }
}
