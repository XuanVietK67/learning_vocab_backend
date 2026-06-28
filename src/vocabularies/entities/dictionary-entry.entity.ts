import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { DictionarySenseRaw } from '@/vocabularies/enrichment/dictionary-client';

/**
 * A multilingual dictionary entry loaded from a Wiktionary export (wiktextract)
 * by the ingest script: one row per (language, lemma, part_of_speech), carrying
 * the IPA and the full sense list. The enrichment worker reads these via
 * WiktionaryDictionaryProvider so non-English (and English dictionary-miss)
 * lemmas go through the dictionary path instead of Gemma — phase 4 of
 * docs/plans/quick_create_without_gemma.md.
 *
 * `senses` mirrors the shape the English dictionary client already produces
 * (definition + optional example + synonyms/antonyms), so both feed the same
 * draftsFromDictionary code.
 */
@Index('UQ_dictionary_entry_key', ['language', 'lemma', 'partOfSpeech'], {
  unique: true,
})
@Entity('dictionary_entry')
export class DictionaryEntry {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 8 })
  language!: string;

  @Column({ type: 'varchar', length: 128 })
  lemma!: string;

  // Raw POS string (e.g. 'noun'); mapped to the PartOfSpeech enum at read time.
  @Column({ name: 'part_of_speech', type: 'varchar', length: 16 })
  partOfSpeech!: string;

  @Column({ type: 'varchar', length: 128, nullable: true })
  ipa!: string | null;

  @Column({ type: 'jsonb' })
  senses!: DictionarySenseRaw[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
