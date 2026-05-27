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
import { VocabularySense } from '@/vocabularies/entities/vocabulary-sense.entity';
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

interface SenseSeed {
  gloss?: string | null;
  definition?: string | null;
  imageUrl?: string | null;
  translations?: TranslationSeed[];
  examples?: ExampleSeed[];
}

// JSON seeds may use either the new `senses[]` shape or the legacy flat shape
// (translations/examples/imageUrl at the top level). Flat shape is normalized
// into a single sense at load time.
interface VocabularySeed {
  language: string;
  lemma: string;
  partOfSpeech: PartOfSpeech;
  ipa?: string | null;
  cefrLevel?: ProficiencyLevel | null;
  frequencyRank?: number | null;
  audioUrl?: string | null;
  topics?: string[];
  senses?: SenseSeed[];
  // Legacy flat-shape fallbacks:
  imageUrl?: string | null;
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

function normalizeSenses(seed: VocabularySeed): SenseSeed[] {
  if (seed.senses && seed.senses.length > 0) return seed.senses;
  return [
    {
      gloss: null,
      definition: null,
      imageUrl: seed.imageUrl ?? null,
      translations: seed.translations ?? [],
      examples: seed.examples ?? [],
    },
  ];
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
  const senseRepo = dataSource.getRepository(VocabularySense);
  const translationRepo = dataSource.getRepository(VocabularyTranslation);
  const exampleRepo = dataSource.getRepository(VocabularyExample);
  const vtRepo = dataSource.getRepository(VocabularyTopic);

  const seeds = loadJson<VocabularySeed[]>('vocabularies.json');
  const keyToId = new Map<string, string>();
  let sensesAdded = 0;
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

    const senseSeeds = normalizeSenses(seed);
    const existingSenses = await senseRepo.find({
      where: { vocabularyId: vocab.id },
      order: { senseOrder: 'ASC' },
    });
    const byOrder = new Map(existingSenses.map((s) => [s.senseOrder, s]));

    for (let i = 0; i < senseSeeds.length; i++) {
      const sd = senseSeeds[i];
      const senseOrder = i + 1;
      let sense = byOrder.get(senseOrder);
      if (sense) {
        sense.gloss = sd.gloss ?? sense.gloss;
        sense.definition = sd.definition ?? sense.definition;
        sense.imageUrl = sd.imageUrl ?? sense.imageUrl;
        sense = await senseRepo.save(sense);
      } else {
        sense = await senseRepo.save(
          senseRepo.create({
            vocabularyId: vocab.id,
            senseOrder,
            gloss: sd.gloss ?? null,
            definition: sd.definition ?? null,
            imageUrl: sd.imageUrl ?? null,
          }),
        );
        sensesAdded++;
      }

      for (const tr of sd.translations ?? []) {
        const existing = await translationRepo.findOne({
          where: {
            senseId: sense.id,
            language: tr.language,
            translation: tr.translation,
          },
        });
        if (!existing) {
          await translationRepo.save(
            translationRepo.create({
              senseId: sense.id,
              language: tr.language,
              translation: tr.translation,
              note: tr.note ?? null,
            }),
          );
          translationsAdded++;
        }
      }

      const existingExamples = await exampleRepo.count({
        where: { senseId: sense.id },
      });
      if (existingExamples === 0 && (sd.examples?.length ?? 0) > 0) {
        const created = (sd.examples ?? []).map((e) =>
          exampleRepo.create({
            senseId: sense.id,
            sentence: e.sentence,
            translation: e.translation ?? null,
            source: e.source ?? 'manual',
          }),
        );
        await exampleRepo.save(created);
        examplesAdded += created.length;
      }
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
    `  vocabularies: upserted ${seeds.length}, +${sensesAdded} senses, +${translationsAdded} translations, +${examplesAdded} examples, +${topicLinks} topic links`,
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
