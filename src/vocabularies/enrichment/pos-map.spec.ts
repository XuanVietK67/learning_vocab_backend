import { PartOfSpeech } from '@/vocabularies/entities/part-of-speech.enum';
import { mapPartOfSpeech } from '@/vocabularies/enrichment/pos-map';

describe('mapPartOfSpeech', () => {
  it('maps the common dictionary parts of speech', () => {
    expect(mapPartOfSpeech('noun')).toBe(PartOfSpeech.NOUN);
    expect(mapPartOfSpeech('verb')).toBe(PartOfSpeech.VERB);
    expect(mapPartOfSpeech('adjective')).toBe(PartOfSpeech.ADJECTIVE);
    expect(mapPartOfSpeech('adverb')).toBe(PartOfSpeech.ADVERB);
  });

  it('is case- and whitespace-insensitive', () => {
    expect(mapPartOfSpeech('  Noun ')).toBe(PartOfSpeech.NOUN);
    expect(mapPartOfSpeech('VERB')).toBe(PartOfSpeech.VERB);
  });

  it('maps exclamation/idiom onto our nearest enum value', () => {
    expect(mapPartOfSpeech('exclamation')).toBe(PartOfSpeech.INTERJECTION);
    expect(mapPartOfSpeech('idiom')).toBe(PartOfSpeech.PHRASE);
  });

  it('returns null for parts of speech we do not model', () => {
    expect(mapPartOfSpeech('determiner')).toBeNull();
    expect(mapPartOfSpeech('article')).toBeNull();
    expect(mapPartOfSpeech('')).toBeNull();
  });
});
