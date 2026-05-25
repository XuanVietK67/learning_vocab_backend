import 'dotenv/config';
import 'tsconfig-paths/register';
import { readFileSync } from 'fs';
import { join } from 'path';
import { IsNull } from 'typeorm';
import dataSource from '@/database/data-source';
import { Deck } from '@/decks/entities/deck.entity';
import { DeckVocabulary } from '@/decks/entities/deck-vocabulary.entity';
import { Topic } from '@/topics/entities/topic.entity';
import { VocabularyTopic } from '@/topics/entities/vocabulary-topic.entity';
import { PartOfSpeech } from '@/vocabularies/entities/part-of-speech.enum';
import { VocabularyExample } from '@/vocabularies/entities/vocabulary-example.entity';
import { VocabularySource } from '@/vocabularies/entities/vocabulary-source.enum';
import { VocabularyTranslation } from '@/vocabularies/entities/vocabulary-translation.entity';
import { Visibility } from '@/vocabularies/entities/visibility.enum';
import { Vocabulary } from '@/vocabularies/entities/vocabulary.entity';
import { ProficiencyLevel } from '@/users/entities/proficiency-level.enum';

interface TopicSeed {
  slug: string;
  name: string;
  description?: string | null;
  iconUrl?: string | null;
}

interface TranslationSeed {
  language: string;
  translation: string;
  note?: string | null;
}

interface ExampleSeed {
  sentence: string;
  translation?: string | null;
  source?: string | null;
}

interface VocabularySeed {
  language: string;
  lemma: string;
  partOfSpeech: PartOfSpeech;
  ipa?: string | null;
  cefrLevel?: ProficiencyLevel | null;
  frequencyRank?: number | null;
  audioUrl?: string | null;
  imageUrl?: string | null;
  topics?: string[];
  translations?: TranslationSeed[];
  examples?: ExampleSeed[];
}

interface DeckMemberRef {
  language: string;
  lemma: string;
  partOfSpeech: PartOfSpeech;
}

interface DeckSeed {
  name: string;
  description?: string | null;
  language: string;
  cefrLevel?: ProficiencyLevel | null;
  vocabularies: DeckMemberRef[];
}

function loadJson<T>(file: string): T {
  const path = join(__dirname, 'data', file);
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

async function seedTopics(): Promise<Map<string, string>> {
  const repo = dataSource.getRepository(Topic);
  const seeds = loadJson<TopicSeed[]>('topics.json');
  const slugToId = new Map<string, string>();

  for (const seed of seeds) {
    let topic = await repo.findOne({ where: { slug: seed.slug } });
    if (topic) {
      topic.name = seed.name;
      topic.description = seed.description ?? null;
      topic.iconUrl = seed.iconUrl ?? null;
    } else {
      topic = repo.create({
        slug: seed.slug,
        name: seed.name,
        description: seed.description ?? null,
        iconUrl: seed.iconUrl ?? null,
      });
    }
    const saved = await repo.save(topic);
    slugToId.set(saved.slug, saved.id);
  }

  console.log(`  topics: upserted ${seeds.length}`);
  return slugToId;
}

async function seedVocabularies(
  topicSlugToId: Map<string, string>,
): Promise<Map<string, string>> {
  const vocabRepo = dataSource.getRepository(Vocabulary);
  const translationRepo = dataSource.getRepository(VocabularyTranslation);
  const exampleRepo = dataSource.getRepository(VocabularyExample);
  const vtRepo = dataSource.getRepository(VocabularyTopic);

  const seeds = loadJson<VocabularySeed[]>('vocabularies.json');
  const keyToId = new Map<string, string>();
  let translationsAdded = 0;
  let examplesAdded = 0;
  let topicLinks = 0;

  for (const seed of seeds) {
    let vocab = await vocabRepo.findOne({
      where: {
        language: seed.language,
        lemma: seed.lemma,
        partOfSpeech: seed.partOfSpeech,
        source: VocabularySource.SYSTEM,
      },
    });

    const fields = {
      language: seed.language,
      lemma: seed.lemma,
      partOfSpeech: seed.partOfSpeech,
      ipa: seed.ipa ?? null,
      cefrLevel: seed.cefrLevel ?? null,
      frequencyRank: seed.frequencyRank ?? null,
      audioUrl: seed.audioUrl ?? null,
      imageUrl: seed.imageUrl ?? null,
      source: VocabularySource.SYSTEM,
      createdByUserId: null,
      visibility: Visibility.SYSTEM,
      isApproved: true,
    };

    if (vocab) {
      Object.assign(vocab, fields);
    } else {
      vocab = vocabRepo.create(fields);
    }
    vocab = await vocabRepo.save(vocab);
    keyToId.set(
      `${seed.language}::${seed.lemma}::${seed.partOfSpeech}`,
      vocab.id,
    );

    for (const tr of seed.translations ?? []) {
      const existing = await translationRepo.findOne({
        where: {
          vocabularyId: vocab.id,
          language: tr.language,
          translation: tr.translation,
        },
      });
      if (!existing) {
        await translationRepo.save(
          translationRepo.create({
            vocabularyId: vocab.id,
            language: tr.language,
            translation: tr.translation,
            note: tr.note ?? null,
          }),
        );
        translationsAdded++;
      }
    }

    const existingExamples = await exampleRepo.count({
      where: { vocabularyId: vocab.id },
    });
    if (existingExamples === 0 && (seed.examples?.length ?? 0) > 0) {
      const created = (seed.examples ?? []).map((e) =>
        exampleRepo.create({
          vocabularyId: vocab.id,
          sentence: e.sentence,
          translation: e.translation ?? null,
          source: e.source ?? 'manual',
        }),
      );
      await exampleRepo.save(created);
      examplesAdded += created.length;
    }

    for (const slug of seed.topics ?? []) {
      const topicId = topicSlugToId.get(slug);
      if (!topicId) {
        throw new Error(
          `vocab "${seed.lemma}" references unknown topic slug: ${slug}`,
        );
      }
      const link = await vtRepo.findOne({
        where: { vocabularyId: vocab.id, topicId },
      });
      if (!link) {
        await vtRepo.save(vtRepo.create({ vocabularyId: vocab.id, topicId }));
        topicLinks++;
      }
    }
  }

  console.log(
    `  vocabularies: upserted ${seeds.length}, +${translationsAdded} translations, +${examplesAdded} examples, +${topicLinks} topic links`,
  );
  return keyToId;
}

async function seedDecks(vocabKeyToId: Map<string, string>): Promise<void> {
  const deckRepo = dataSource.getRepository(Deck);
  const dvRepo = dataSource.getRepository(DeckVocabulary);
  const seeds = loadJson<DeckSeed[]>('decks.json');

  for (const seed of seeds) {
    let deck = await deckRepo.findOne({
      where: {
        name: seed.name,
        language: seed.language,
        ownerId: IsNull(),
      },
    });

    const fields = {
      name: seed.name,
      description: seed.description ?? null,
      language: seed.language,
      cefrLevel: seed.cefrLevel ?? null,
      ownerId: null,
      visibility: Visibility.SYSTEM,
      vocabCount: seed.vocabularies.length,
    };

    if (deck) {
      Object.assign(deck, fields);
    } else {
      deck = deckRepo.create(fields);
    }
    deck = await deckRepo.save(deck);

    for (let i = 0; i < seed.vocabularies.length; i++) {
      const ref = seed.vocabularies[i];
      const vocabId = vocabKeyToId.get(
        `${ref.language}::${ref.lemma}::${ref.partOfSpeech}`,
      );
      if (!vocabId) {
        throw new Error(
          `deck "${seed.name}" references unknown vocab: ${ref.lemma}/${ref.partOfSpeech}`,
        );
      }
      const existing = await dvRepo.findOne({
        where: { deckId: deck.id, vocabularyId: vocabId },
      });
      if (existing) {
        existing.position = i;
        await dvRepo.save(existing);
      } else {
        await dvRepo.save(
          dvRepo.create({
            deckId: deck.id,
            vocabularyId: vocabId,
            position: i,
          }),
        );
      }
    }
  }

  console.log(`  decks: upserted ${seeds.length}`);
}

async function main(): Promise<void> {
  console.log('seeding vocabulary catalog…');
  await dataSource.initialize();
  try {
    const topicSlugToId = await seedTopics();
    const vocabKeyToId = await seedVocabularies(topicSlugToId);
    await seedDecks(vocabKeyToId);
    console.log('seed complete.');
  } finally {
    await dataSource.destroy();
  }
}

main().catch((err) => {
  console.error('seed failed:', err);
  process.exit(1);
});
