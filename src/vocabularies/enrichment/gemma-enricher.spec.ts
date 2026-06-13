import { ProficiencyLevel } from '@/users/entities/proficiency-level.enum';
import { PartOfSpeech } from '@/vocabularies/entities/part-of-speech.enum';
import {
  BatchExamplesWordInput,
  buildExamplesPrompt,
  parseBatchExamplesResponse,
  parseBatchScratchResponse,
  parseExamplesResponse,
  parseScratchResponse,
} from '@/vocabularies/enrichment/gemma-enricher';

describe('buildExamplesPrompt', () => {
  it('numbers the senses and embeds lemma/POS/language', () => {
    const prompt = buildExamplesPrompt({
      lemma: 'run',
      partOfSpeech: 'verb',
      language: 'en',
      senses: [{ definition: 'move quickly' }, { definition: 'operate' }],
    });
    expect(prompt).toContain('"run"');
    expect(prompt).toContain('verb');
    expect(prompt).toContain('1. move quickly');
    expect(prompt).toContain('2. operate');
    expect(prompt).toContain('exactly 2 item(s)');
  });

  it('omits the translation field when no translationLanguage is given', () => {
    const prompt = buildExamplesPrompt({
      lemma: 'run',
      partOfSpeech: 'verb',
      language: 'en',
      senses: [{ definition: 'move quickly' }],
    });
    expect(prompt).not.toContain('translation');
  });

  it('asks for a translation in the requested language when given', () => {
    const prompt = buildExamplesPrompt({
      lemma: 'run',
      partOfSpeech: 'verb',
      language: 'en',
      senses: [{ definition: 'move quickly' }],
      translationLanguage: 'vi',
    });
    expect(prompt).toContain('"translation"');
    expect(prompt).toContain('language "vi"');
  });
});

describe('parseExamplesResponse', () => {
  const valid = JSON.stringify({
    cefr: 'B1',
    senses: [
      { gloss: 'move fast', examples: ['I run daily.', 'She runs home.'] },
      { gloss: 'operate', examples: ['He runs a shop.', 'They run it well.'] },
    ],
  });

  it('parses a clean response aligned to the expected count', () => {
    const r = parseExamplesResponse(valid, 2);
    expect(r.cefr).toBe(ProficiencyLevel.B1);
    expect(r.senses).toHaveLength(2);
    expect(r.senses[0].gloss).toBe('move fast');
    expect(r.senses[0].examples).toHaveLength(2);
  });

  it('parses a per-sense translation when present, undefined when absent', () => {
    const withTranslation = JSON.stringify({
      cefr: 'B1',
      senses: [
        {
          gloss: 'move fast',
          translation: 'chạy',
          examples: ['I run daily.', 'She runs home.'],
        },
      ],
    });
    const r = parseExamplesResponse(withTranslation, 1);
    expect(r.senses[0].translation).toBe('chạy');

    const r2 = parseExamplesResponse(valid, 1);
    expect(r2.senses[0].translation).toBeUndefined();
  });

  it('strips ```json fences', () => {
    const r = parseExamplesResponse('```json\n' + valid + '\n```', 2);
    expect(r.senses).toHaveLength(2);
  });

  it('throws when a sense has fewer than 2 examples', () => {
    const bad = JSON.stringify({
      cefr: 'A2',
      senses: [{ gloss: 'x', examples: ['only one'] }],
    });
    expect(() => parseExamplesResponse(bad, 1)).toThrow(/fewer than 2/);
  });

  it('throws on an invalid CEFR', () => {
    const bad = JSON.stringify({
      cefr: 'Z9',
      senses: [{ gloss: 'x', examples: ['a', 'b'] }],
    });
    expect(() => parseExamplesResponse(bad, 1)).toThrow(/cefr/);
  });

  it('throws when fewer senses than expected are returned', () => {
    expect(() => parseExamplesResponse(valid, 3)).toThrow(/expected 3/);
  });
});

describe('parseScratchResponse', () => {
  const valid = JSON.stringify({
    cefr: 'B2',
    partsOfSpeech: [
      {
        partOfSpeech: 'noun',
        senses: [
          {
            gloss: 'a race',
            definition: 'an act of running',
            examples: ['The run was hard.', 'A morning run helps.'],
          },
        ],
      },
      {
        partOfSpeech: 'determiner', // not modelled -> skipped
        senses: [{ gloss: 'x', definition: 'y', examples: ['a', 'b'] }],
      },
    ],
  });

  it('maps POS groups and drops unmodelled parts of speech', () => {
    const groups = parseScratchResponse(valid);
    expect(groups).toHaveLength(1);
    expect(groups[0].partOfSpeech).toBe(PartOfSpeech.NOUN);
    expect(groups[0].cefr).toBe(ProficiencyLevel.B2);
    expect(groups[0].senses[0].definition).toBe('an act of running');
  });

  it('drops senses missing a definition or with fewer than 2 examples', () => {
    const groups = parseScratchResponse(
      JSON.stringify({
        cefr: 'A1',
        partsOfSpeech: [
          {
            partOfSpeech: 'noun',
            senses: [
              { gloss: 'g', definition: '', examples: ['a', 'b'] },
              { gloss: 'g', definition: 'd', examples: ['only one'] },
            ],
          },
        ],
      }),
    );
    expect(groups).toHaveLength(0);
  });
});

describe('parseBatchExamplesResponse', () => {
  const words: BatchExamplesWordInput[] = [
    {
      lemma: 'run',
      language: 'en',
      posGroups: [
        {
          partOfSpeech: PartOfSpeech.VERB,
          senses: [{ definition: 'move quickly' }, { definition: 'operate' }],
        },
        {
          partOfSpeech: PartOfSpeech.NOUN,
          senses: [{ definition: 'an act of running' }],
        },
      ],
    },
    {
      lemma: 'book',
      language: 'en',
      posGroups: [
        {
          partOfSpeech: PartOfSpeech.NOUN,
          senses: [{ definition: 'a written work' }],
        },
      ],
    },
  ];

  // Note: words are intentionally out of order to exercise lemma-based matching.
  const valid = JSON.stringify({
    words: [
      {
        lemma: 'book',
        cefr: 'A1',
        partsOfSpeech: [
          {
            partOfSpeech: 'noun',
            senses: [
              {
                gloss: 'reading',
                examples: ['I read a book.', 'A good book.'],
              },
            ],
          },
        ],
      },
      {
        lemma: 'run',
        cefr: 'B1',
        partsOfSpeech: [
          {
            partOfSpeech: 'verb',
            senses: [
              {
                gloss: 'move fast',
                examples: ['I run daily.', 'She runs home.'],
              },
              {
                gloss: 'operate',
                examples: ['He runs a shop.', 'They run it.'],
              },
            ],
          },
          {
            partOfSpeech: 'noun',
            senses: [
              { gloss: 'a jog', examples: ['A morning run.', 'We had a run.'] },
            ],
          },
        ],
      },
    ],
  });

  it('aligns each word by lemma despite response reordering', () => {
    const results = parseBatchExamplesResponse(valid, words);
    expect(results).toHaveLength(2);

    const run = results[0];
    expect(run.ok).toBe(true);
    if (run.ok) {
      expect(run.value.cefr).toBe(ProficiencyLevel.B1);
      expect(run.value.posGroups).toHaveLength(2);
      expect(run.value.posGroups[0].partOfSpeech).toBe(PartOfSpeech.VERB);
      expect(run.value.posGroups[0].senses).toHaveLength(2);
      expect(run.value.posGroups[1].partOfSpeech).toBe(PartOfSpeech.NOUN);
    }

    expect(results[1].ok).toBe(true);
  });

  it('fails only the missing word, not its batch siblings', () => {
    const parsedValid = JSON.parse(valid) as { words: unknown[] };
    const onlyRun = JSON.stringify({
      words: [parsedValid.words[1]], // run only
    });
    const results = parseBatchExamplesResponse(onlyRun, words);
    expect(results[0].ok).toBe(true); // run matched by lemma
    expect(results[1].ok).toBe(false); // book absent
  });

  it('fails only the word whose sense has too few examples', () => {
    const badRun = JSON.stringify({
      words: [
        {
          lemma: 'run',
          cefr: 'B1',
          partsOfSpeech: [
            {
              partOfSpeech: 'verb',
              senses: [
                { gloss: 'x', examples: ['only one'] },
                { gloss: 'y', examples: ['a', 'b'] },
              ],
            },
            {
              partOfSpeech: 'noun',
              senses: [{ gloss: 'z', examples: ['a', 'b'] }],
            },
          ],
        },
        {
          lemma: 'book',
          cefr: 'A1',
          partsOfSpeech: [
            {
              partOfSpeech: 'noun',
              senses: [{ gloss: 'reading', examples: ['a', 'b'] }],
            },
          ],
        },
      ],
    });
    const results = parseBatchExamplesResponse(badRun, words);
    expect(results[0].ok).toBe(false); // run: first verb sense < 2 examples
    expect(results[1].ok).toBe(true); // book unaffected
  });

  it('throws when the whole batch is not valid JSON', () => {
    expect(() =>
      parseBatchExamplesResponse('not json at all', words),
    ).toThrow();
  });
});

describe('parseBatchScratchResponse', () => {
  const valid = JSON.stringify({
    words: [
      {
        lemma: 'run',
        cefr: 'B1',
        partsOfSpeech: [
          {
            partOfSpeech: 'noun',
            senses: [
              {
                gloss: 'a jog',
                definition: 'an act of running',
                examples: ['A run.', 'Go for a run.'],
              },
            ],
          },
        ],
      },
    ],
  });

  it('parses present words and fails missing ones independently', () => {
    const results = parseBatchScratchResponse(valid, ['run', 'xyzzy']);
    expect(results[0].ok).toBe(true);
    if (results[0].ok) {
      expect(results[0].value[0].partOfSpeech).toBe(PartOfSpeech.NOUN);
      expect(results[0].value[0].cefr).toBe(ProficiencyLevel.B1);
    }
    expect(results[1].ok).toBe(false); // xyzzy absent
  });

  it('throws when the whole batch is not valid JSON', () => {
    expect(() => parseBatchScratchResponse('{bad', ['run'])).toThrow();
  });
});
