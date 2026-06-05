import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ProficiencyLevel } from '@/users/entities/proficiency-level.enum';
import { EnrichmentStatus } from '@/vocabularies/entities/enrichment-status.enum';
import { PartOfSpeech } from '@/vocabularies/entities/part-of-speech.enum';
import { VocabularyExample } from '@/vocabularies/entities/vocabulary-example.entity';
import { VocabularySense } from '@/vocabularies/entities/vocabulary-sense.entity';
import { VocabularySource } from '@/vocabularies/entities/vocabulary-source.enum';
import { VocabularyTranslation } from '@/vocabularies/entities/vocabulary-translation.entity';
import { Vocabulary } from '@/vocabularies/entities/vocabulary.entity';
import { Visibility } from '@/vocabularies/entities/visibility.enum';

export interface PersistTranslation {
  language: string;
  translation: string;
  note?: string | null;
  source?: string;
}

export interface PersistExample {
  sentence: string;
  translation?: string | null;
  source?: string;
}

export interface PersistSense {
  gloss?: string | null;
  definition?: string | null;
  imageUrl?: string | null;
  synonyms?: string[];
  antonyms?: string[];
  examples: PersistExample[];
  translations?: PersistTranslation[];
}

export interface PersistVocabularyInput {
  language: string;
  lemma: string;
  partOfSpeech: PartOfSpeech;
  ipa?: string | null;
  cefrLevel?: ProficiencyLevel | null;
  frequencyRank?: number | null;
  audioUrl?: string | null;
  source: VocabularySource;
  visibility: Visibility;
  isApproved: boolean;
  enrichmentStatus?: EnrichmentStatus | null;
  createdByUserId?: string | null;
  senses: PersistSense[];
}

/**
 * Create-only writer for the full vocabulary -> sense -> example/translation
 * graph, in one transaction. Used by the enrichment worker (and any other
 * caller that needs to insert a brand-new vocabulary with arbitrary
 * source/approval/enrichment flags). Deliberately self-contained — only a
 * DataSource dependency — so the worker module can provide it without importing
 * the HTTP/queue side of VocabulariesModule.
 *
 * This is CREATE-only (no upsert/merge): callers that may collide with an
 * existing row must check beforehand. Topics are intentionally not linked here;
 * drafts get topics assigned during admin review.
 */
@Injectable()
export class VocabularyPersistenceService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async createVocabulary(input: PersistVocabularyInput): Promise<Vocabulary> {
    return this.dataSource.transaction(async (manager) => {
      const vocabRepo = manager.getRepository(Vocabulary);
      const vocab = await vocabRepo.save(
        vocabRepo.create({
          language: input.language,
          lemma: input.lemma,
          partOfSpeech: input.partOfSpeech,
          ipa: input.ipa ?? null,
          cefrLevel: input.cefrLevel ?? null,
          frequencyRank: input.frequencyRank ?? null,
          audioUrl: input.audioUrl ?? null,
          source: input.source,
          visibility: input.visibility,
          isApproved: input.isApproved,
          enrichmentStatus: input.enrichmentStatus ?? null,
          createdByUserId: input.createdByUserId ?? null,
        }),
      );

      const senseRepo = manager.getRepository(VocabularySense);
      const exampleRepo = manager.getRepository(VocabularyExample);
      const translationRepo = manager.getRepository(VocabularyTranslation);

      for (let i = 0; i < input.senses.length; i++) {
        const s = input.senses[i];
        const sense = await senseRepo.save(
          senseRepo.create({
            vocabularyId: vocab.id,
            senseOrder: i + 1,
            gloss: s.gloss ?? null,
            definition: s.definition ?? null,
            imageUrl: s.imageUrl ?? null,
            synonyms: s.synonyms ?? [],
            antonyms: s.antonyms ?? [],
          }),
        );

        if (s.examples.length > 0) {
          await exampleRepo.save(
            s.examples.map((e) =>
              exampleRepo.create({
                senseId: sense.id,
                sentence: e.sentence,
                translation: e.translation ?? null,
                source: e.source ?? 'manual',
              }),
            ),
          );
        }

        if (s.translations && s.translations.length > 0) {
          await translationRepo.save(
            s.translations.map((t) =>
              translationRepo.create({
                senseId: sense.id,
                language: t.language,
                translation: t.translation,
                note: t.note ?? null,
                source: t.source ?? 'manual',
              }),
            ),
          );
        }
      }

      return vocab;
    });
  }
}
