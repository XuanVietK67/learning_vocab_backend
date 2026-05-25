import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { Deck } from '@/decks/entities/deck.entity';
import { Vocabulary } from '@/vocabularies/entities/vocabulary.entity';

@Index('IDX_deck_vocabularies_deck_position', ['deckId', 'position'])
@Entity('deck_vocabularies')
export class DeckVocabulary {
  @PrimaryColumn({ name: 'deck_id', type: 'uuid' })
  deckId!: string;

  @PrimaryColumn({ name: 'vocabulary_id', type: 'uuid' })
  vocabularyId!: string;

  @ManyToOne(() => Deck, (deck) => deck.deckVocabularies, {
    onDelete: 'CASCADE',
    nullable: false,
  })
  @JoinColumn({ name: 'deck_id' })
  deck!: Deck;

  @ManyToOne(() => Vocabulary, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'vocabulary_id' })
  vocabulary!: Vocabulary;

  @Column({ type: 'int', default: 0 })
  position!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
