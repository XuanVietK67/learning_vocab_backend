import { parseDictionaryResponse } from '@/vocabularies/enrichment/dictionary-client';

// Trimmed shape of a real dictionaryapi.dev response for "run".
const runResponse = [
  {
    word: 'run',
    phonetic: '/ɹʌn/',
    phonetics: [{ text: '/ɹʌn/', audio: 'https://example.com/run.mp3' }],
    meanings: [
      {
        partOfSpeech: 'verb',
        definitions: [
          {
            definition: 'To move quickly on foot.',
            example: 'I run every morning.',
            synonyms: ['sprint', 'dash'],
            antonyms: ['walk'],
          },
          {
            definition: 'To manage or operate.',
            synonyms: [],
            antonyms: [],
          },
        ],
        synonyms: ['operate'],
        antonyms: [],
      },
      {
        partOfSpeech: 'noun',
        definitions: [{ definition: 'An act of running.' }],
        synonyms: [],
        antonyms: [],
      },
    ],
  },
];

describe('parseDictionaryResponse', () => {
  it('groups senses by part of speech', () => {
    const groups = parseDictionaryResponse(runResponse);
    expect(groups).toHaveLength(2);
    const verb = groups.find((g) => g.partOfSpeechRaw === 'verb');
    const noun = groups.find((g) => g.partOfSpeechRaw === 'noun');
    expect(verb?.senses).toHaveLength(2);
    expect(noun?.senses).toHaveLength(1);
  });

  it('applies the word IPA to every group', () => {
    const groups = parseDictionaryResponse(runResponse);
    expect(groups.every((g) => g.ipa === '/ɹʌn/')).toBe(true);
  });

  it('keeps definition + example and merges meaning-level synonyms', () => {
    const groups = parseDictionaryResponse(runResponse);
    const verb = groups.find((g) => g.partOfSpeechRaw === 'verb');
    const first = verb!.senses[0];
    expect(first.definition).toBe('To move quickly on foot.');
    expect(first.example).toBe('I run every morning.');
    // def-level + meaning-level synonyms, deduped
    expect(first.synonyms).toEqual(
      expect.arrayContaining(['sprint', 'dash', 'operate']),
    );
    expect(first.antonyms).toContain('walk');
  });

  it('drops definitions without text and meanings without definitions', () => {
    const groups = parseDictionaryResponse([
      {
        meanings: [
          { partOfSpeech: 'noun', definitions: [{ definition: '' }] },
          { partOfSpeech: 'verb', definitions: [] },
        ],
      },
    ]);
    expect(groups).toHaveLength(0);
  });

  it('returns an empty array for a non-array body', () => {
    expect(parseDictionaryResponse({ title: 'No Definitions Found' })).toEqual(
      [],
    );
    expect(parseDictionaryResponse(null)).toEqual([]);
  });
});
