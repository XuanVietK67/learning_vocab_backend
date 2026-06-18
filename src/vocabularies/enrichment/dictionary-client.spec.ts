import {
  composeIpa,
  composeIpaFromWords,
  parseDictionaryResponse,
  singularFallbacks,
  stripIpaDelimiters,
} from '@/vocabularies/enrichment/dictionary-client';

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

describe('stripIpaDelimiters', () => {
  it('strips surrounding slashes and brackets', () => {
    expect(stripIpaDelimiters('/ˈɪnkʌm/')).toBe('ˈɪnkʌm');
    expect(stripIpaDelimiters('[əˈbaʊt]')).toBe('əˈbaʊt');
    expect(stripIpaDelimiters('  /kæt/  ')).toBe('kæt');
  });

  it('leaves undelimited text untouched', () => {
    expect(stripIpaDelimiters('kæt')).toBe('kæt');
  });
});

describe('singularFallbacks', () => {
  it('prefers the -ies → -y singular first', () => {
    expect(singularFallbacks('disparities')[0]).toBe('disparity');
  });

  it('handles -es and -s plurals', () => {
    expect(singularFallbacks('boxes')).toContain('box');
    expect(singularFallbacks('cats')).toContain('cat');
  });

  it('does not strip -ss words or single-character words', () => {
    expect(singularFallbacks('glass')).toEqual([]);
    expect(singularFallbacks('s')).toEqual([]);
  });
});

describe('composeIpa', () => {
  it('joins per-word IPA into one slash-wrapped phrase', () => {
    expect(composeIpa(['/ˈɪnkʌm/', '/dɪˈspærɪti/'])).toBe(
      '/ˈɪnkʌm dɪˈspærɪti/',
    );
  });

  it('returns null when any word is missing', () => {
    expect(composeIpa(['/ˈɪnkʌm/', null])).toBeNull();
    expect(composeIpa([])).toBeNull();
  });
});

describe('composeIpaFromWords', () => {
  const originalFetch = global.fetch;

  // Route the dictionary fetch by the requested word (last path segment),
  // returning a 404 for any word not in the map.
  function mockDictionary(map: Record<string, string>): void {
    const impl = (input: string): Promise<Response> => {
      const word = decodeURIComponent(input.split('/').pop() ?? '');
      const ipa = map[word];
      if (!ipa) {
        return Promise.resolve({
          status: 404,
          ok: false,
          json: () => Promise.resolve({}),
          text: () => Promise.resolve(''),
        } as unknown as Response);
      }
      return Promise.resolve({
        status: 200,
        ok: true,
        json: () => Promise.resolve([{ phonetic: ipa }]),
        text: () => Promise.resolve(''),
      } as unknown as Response);
    };
    global.fetch = jest.fn(impl);
  }

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns null (no fetch) for a single-word lemma', async () => {
    mockDictionary({ income: '/ˈɪnkʌm/' });
    expect(await composeIpaFromWords('income')).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('composes IPA from each word, retrying the singular form', async () => {
    // "disparities" 404s; "disparity" resolves via the singular fallback.
    mockDictionary({ income: '/ˈɪnkʌm/', disparity: '/dɪˈspærɪti/' });
    expect(await composeIpaFromWords('income disparities')).toBe(
      '/ˈɪnkʌm dɪˈspærɪti/',
    );
  });

  it('returns null when a word cannot be resolved at all', async () => {
    mockDictionary({ income: '/ˈɪnkʌm/' });
    expect(await composeIpaFromWords('income zzzznotaword')).toBeNull();
  });
});
