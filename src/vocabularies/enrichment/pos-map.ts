import { PartOfSpeech } from '@/vocabularies/entities/part-of-speech.enum';

/**
 * Map a dictionary part-of-speech string (e.g. from dictionaryapi.dev) onto our
 * PartOfSpeech enum. Returns null for anything we do not model (determiner,
 * article, numeral, prefix, …) so the caller can skip that POS group rather than
 * inventing a row. Case/whitespace-insensitive.
 */
const POS_LOOKUP: Record<string, PartOfSpeech> = {
  noun: PartOfSpeech.NOUN,
  verb: PartOfSpeech.VERB,
  adjective: PartOfSpeech.ADJECTIVE,
  adverb: PartOfSpeech.ADVERB,
  pronoun: PartOfSpeech.PRONOUN,
  preposition: PartOfSpeech.PREPOSITION,
  conjunction: PartOfSpeech.CONJUNCTION,
  interjection: PartOfSpeech.INTERJECTION,
  exclamation: PartOfSpeech.INTERJECTION,
  phrase: PartOfSpeech.PHRASE,
  idiom: PartOfSpeech.PHRASE,
};

export function mapPartOfSpeech(raw: string): PartOfSpeech | null {
  return POS_LOOKUP[raw.trim().toLowerCase()] ?? null;
}
