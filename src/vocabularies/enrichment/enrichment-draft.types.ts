import { ProficiencyLevel } from '@/users/entities/proficiency-level.enum';
import { PartOfSpeech } from '@/vocabularies/entities/part-of-speech.enum';
import { PersistSense } from '@/vocabularies/vocabulary-persistence.service';

/**
 * One ready-to-persist draft vocabulary produced by the enrichment pipeline:
 * a single part of speech with its IPA, CEFR, and the full sense graph
 * (gloss/definition/synonyms/antonyms/examples/translations). `prepareDrafts`
 * returns `DraftInput[]` (one per resolved part of speech) and that array is
 * exactly what the enrichment cache stores as JSON — a cache hit replays the
 * whole model+dictionary output without any network call. Shared by the
 * processor and the cache so the cached shape and the persisted shape can't
 * drift apart.
 */
export interface DraftInput {
  partOfSpeech: PartOfSpeech;
  ipa: string | null;
  cefrLevel: ProficiencyLevel;
  senses: PersistSense[];
}
