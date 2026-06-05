import { tokenize } from '@/vocabularies/enrichment/import/tokenize';

describe('tokenize — list mode', () => {
  it('splits on newlines and commas, trimming entries', () => {
    const { lemmas, removedStopwords } = tokenize(
      'ephemeral\nserendipity , run\n\n  ubiquitous  ',
      'list',
    );
    expect(lemmas).toEqual(['ephemeral', 'serendipity', 'run', 'ubiquitous']);
    expect(removedStopwords).toBe(0);
  });

  it('preserves multi-word entries (phrases)', () => {
    const { lemmas } = tokenize('break the ice\npiece of cake', 'list');
    expect(lemmas).toEqual(['break the ice', 'piece of cake']);
  });
});

describe('tokenize — prose mode', () => {
  it('lowercases, strips stopwords, drops 1-char tokens', () => {
    const { lemmas, removedStopwords } = tokenize(
      'The ephemeral beauty of a fleeting moment.',
      'prose',
    );
    // "the" and "of" are stopwords; "a" is dropped by the length filter before
    // the stopword check, so it isn't counted.
    expect(lemmas).toEqual(['ephemeral', 'beauty', 'fleeting', 'moment']);
    expect(removedStopwords).toBe(2);
  });

  it('keeps intra-word hyphens/apostrophes and ignores punctuation', () => {
    const { lemmas } = tokenize("well-being isn't trivial!", 'prose');
    expect(lemmas).toContain('well-being');
    expect(lemmas).toContain("isn't");
    expect(lemmas).toContain('trivial');
  });
});
