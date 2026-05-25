import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { IsNull, Repository } from 'typeorm';
import { Deck } from '@/decks/entities/deck.entity';
import { DeckVocabulary } from '@/decks/entities/deck-vocabulary.entity';
import { DeckQueryDto } from '@/decks/dto/deck-query.dto';
import {
  DeckDetailResponseDto,
  DeckSummaryResponseDto,
  PaginatedDecksResponseDto,
} from '@/decks/dto/deck-response.dto';
import { User } from '@/users/entities/user.entity';

@Injectable()
export class DecksService {
  constructor(
    @InjectRepository(Deck)
    private readonly deckRepo: Repository<Deck>,
    @InjectRepository(DeckVocabulary)
    private readonly deckVocabRepo: Repository<DeckVocabulary>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
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
      .where('dv.deck_id = :deckId', { deckId: id })
      .orderBy('dv.position', 'ASC')
      .getMany();

    const vocabularies = members.map((m) => m.vocabulary);

    return plainToInstance(
      DeckDetailResponseDto,
      { ...deck, vocabularies },
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
}
