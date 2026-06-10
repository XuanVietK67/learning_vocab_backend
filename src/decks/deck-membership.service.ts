import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { Deck } from '@/decks/entities/deck.entity';
import { DeckVocabulary } from '@/decks/entities/deck-vocabulary.entity';
import { DeckMembershipSummaryDto } from '@/decks/dto/deck-membership.dto';
import { VocabularySource } from '@/vocabularies/entities/vocabulary-source.enum';
import { Vocabulary } from '@/vocabularies/entities/vocabulary.entity';

/**
 * Shared deck-membership writer. Owns the "append vocab to a deck" logic
 * (accessibility filtering, dedup, positions, vocab_count) so both DecksService
 * (HTTP side) and the enrichment worker (which lands bulk-imported words into a
 * target deck) use one implementation. Operates on a caller-supplied
 * EntityManager so it can join an existing transaction.
 */
@Injectable()
export class DeckMembershipService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  // Convenience for callers not already inside a transaction (e.g. the worker).
  async appendMembersTx(
    deckId: string,
    requestedIds: string[],
    ownerUserId: string,
  ): Promise<DeckMembershipSummaryDto> {
    return this.dataSource.transaction((manager) =>
      this.appendMembers(manager, deckId, requestedIds, ownerUserId),
    );
  }

  // Appends the given vocab IDs after existing members and updates vocab_count.
  // Inaccessible (other users' private) and missing IDs are dropped into the
  // summary so the client can show stale-UI hints.
  async appendMembers(
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
