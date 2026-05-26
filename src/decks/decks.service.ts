import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import { Deck } from '@/decks/entities/deck.entity';
import { DeckVocabulary } from '@/decks/entities/deck-vocabulary.entity';
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
import { VocabularySource } from '@/vocabularies/entities/vocabulary-source.enum';
import { Visibility } from '@/vocabularies/entities/visibility.enum';
import { Vocabulary } from '@/vocabularies/entities/vocabulary.entity';

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

  async findById(
    id: string,
    translationLang?: string,
  ): Promise<DeckDetailResponseDto> {
    const deck = await this.deckRepo.findOne({ where: { id } });
    if (!deck) {
      throw new NotFoundException('deck not found');
    }
    return this.loadDeckDetail(deck, translationLang);
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
        visibility: Visibility.PRIVATE,
        vocabCount: 0,
      });
      const saved = await deckRepo.save(created);

      if (dto.vocabularyIds && dto.vocabularyIds.length > 0) {
        await this.appendDeckMembers(
          manager,
          saved.id,
          dto.vocabularyIds,
          userId,
        );
      }
      return saved;
    });

    return this.findById(deck.id);
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
      this.appendDeckMembers(manager, deckId, dto.vocabularyIds, userId),
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
      .leftJoinAndSelect('dv.vocabulary', 'vocab');

    if (translationLang) {
      dvQb.leftJoinAndSelect(
        'vocab.translations',
        'translations',
        'translations.language = :translationLang',
        { translationLang },
      );
    } else {
      dvQb.leftJoinAndSelect('vocab.translations', 'translations');
    }

    const members = await dvQb
      .where('dv.deck_id = :deckId', { deckId: deck.id })
      .orderBy('dv.position', 'ASC')
      .getMany();

    const vocabularies = members.map((m) => m.vocabulary);
    return plainToInstance(
      DeckDetailResponseDto,
      { ...deck, vocabularies },
      { excludeExtraneousValues: true },
    );
  }

  // Appends the given vocab IDs after existing members and updates vocab_count.
  // Inaccessible (other users' private) and missing IDs are dropped into the
  // summary so the client can show stale-UI hints.
  private async appendDeckMembers(
    manager: EntityManager,
    deckId: string,
    requestedIds: string[],
    ownerUserId: string,
  ): Promise<DeckMembershipSummaryDto> {
    const dedupedIds = Array.from(new Set(requestedIds));

    // Accessibility: system vocab + the owner's own user vocab.
    const accessibleRows = await manager
      .getRepository(Vocabulary)
      .createQueryBuilder('v')
      .select('v.id', 'id')
      .where('v.id IN (:...ids)', { ids: dedupedIds })
      .andWhere(
        '(v.source = :system OR (v.source = :user AND v.created_by_user_id = :ownerUserId))',
        {
          system: VocabularySource.SYSTEM,
          user: VocabularySource.USER,
          ownerUserId,
        },
      )
      .getRawMany<{ id: string }>();
    const accessibleSet = new Set(accessibleRows.map((r) => r.id));
    const inaccessibleVocabularyIds = dedupedIds.filter(
      (id) => !accessibleSet.has(id),
    );
    const accessibleIds = dedupedIds.filter((id) => accessibleSet.has(id));

    const dvRepo = manager.getRepository(DeckVocabulary);
    let alreadyMember = 0;
    let toInsert: string[] = [];
    if (accessibleIds.length > 0) {
      const existingRows = await dvRepo.find({
        where: { deckId },
        select: { vocabularyId: true },
      });
      const existingSet = new Set(existingRows.map((r) => r.vocabularyId));
      toInsert = accessibleIds.filter((id) => !existingSet.has(id));
      alreadyMember = accessibleIds.length - toInsert.length;
    }

    let added = 0;
    if (toInsert.length > 0) {
      const maxPosRow = await dvRepo
        .createQueryBuilder('dv')
        .select('COALESCE(MAX(dv.position), -1)', 'max')
        .where('dv.deck_id = :deckId', { deckId })
        .getRawOne<{ max: string | number | null }>();
      const startPos = Number(maxPosRow?.max ?? -1) + 1;

      const rows = toInsert.map((vocabularyId, i) =>
        dvRepo.create({
          deckId,
          vocabularyId,
          position: startPos + i,
        }),
      );
      await dvRepo.save(rows);
      added = rows.length;

      const deckRepo = manager.getRepository(Deck);
      await deckRepo.increment({ id: deckId }, 'vocabCount', added);
    }

    const updatedDeck = await manager
      .getRepository(Deck)
      .findOne({ where: { id: deckId }, select: { vocabCount: true } });

    return {
      added,
      alreadyMember,
      inaccessibleVocabularyIds,
      vocabCount: updatedDeck?.vocabCount ?? 0,
    };
  }
}
