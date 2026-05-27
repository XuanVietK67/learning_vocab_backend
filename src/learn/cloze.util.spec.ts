import {
  BLANK,
  buildCloze,
  deterministicShuffle,
  findLemmaSpan,
  levenshtein,
  normalizeAnswer,
  tokenizeSentence,
} from '@/learn/cloze.util';
import { PartOfSpeech } from '@/vocabularies/entities/part-of-speech.enum';

describe('buildCloze', () => {
  it('blanks the exact verb -s inflection that appears in the sentence', () => {
    const r = buildCloze(
      'She studies biology at university.',
      'study',
      PartOfSpeech.VERB,
    );
    expect(r).not.toBeNull();
    expect(r!.blankedForm).toBe('studies');
    expect(r!.sentenceWithBlank).toBe(`She ${BLANK} biology at university.`);
  });

  it('blanks the lemma form when present', () => {
    const r = buildCloze(
      'I need to study for the exam.',
      'study',
      PartOfSpeech.VERB,
    );
    expect(r!.blankedForm).toBe('study');
    expect(r!.sentenceWithBlank).toBe(`I need to ${BLANK} for the exam.`);
  });

  it('matches case-insensitively', () => {
    const r = buildCloze(
      'Study makes you smarter.',
      'study',
      PartOfSpeech.VERB,
    );
    expect(r!.blankedForm).toBe('Study');
    expect(r!.sentenceWithBlank).toBe(`${BLANK} makes you smarter.`);
  });

  it('blanks -ed past tense', () => {
    const r = buildCloze(
      'He studied French for three years.',
      'study',
      PartOfSpeech.VERB,
    );
    expect(r!.blankedForm).toBe('studied');
  });

  it('returns null if no form is found', () => {
    const r = buildCloze(
      'No relevant content here.',
      'study',
      PartOfSpeech.VERB,
    );
    expect(r).toBeNull();
  });

  it('does not match substrings ("students" should not blank "study")', () => {
    const r = buildCloze('The students went home.', 'study', PartOfSpeech.VERB);
    expect(r).toBeNull();
  });

  it('blanks noun plurals', () => {
    const r = buildCloze('She has two books.', 'book', PartOfSpeech.NOUN);
    expect(r!.blankedForm).toBe('books');
  });
});

describe('findLemmaSpan', () => {
  it('returns the start/end of the matched form', () => {
    const span = findLemmaSpan(
      'Scientists are studying climate change.',
      'study',
      PartOfSpeech.VERB,
    );
    expect(span).not.toBeNull();
    expect(span!.form).toBe('studying');
    expect(span!.start).toBe('Scientists are '.length);
    expect(span!.end).toBe(span!.start + 'studying'.length);
  });
});

describe('tokenizeSentence', () => {
  it('splits on whitespace', () => {
    expect(tokenizeSentence('She studies biology at university.')).toEqual([
      'She',
      'studies',
      'biology',
      'at',
      'university.',
    ]);
  });
});

describe('deterministicShuffle', () => {
  it('returns same permutation for same seed', () => {
    const a = deterministicShuffle([1, 2, 3, 4, 5], 'seed-1');
    const b = deterministicShuffle([1, 2, 3, 4, 5], 'seed-1');
    expect(a).toEqual(b);
  });
  it('returns a permutation (no loss/dup)', () => {
    const orig = ['a', 'b', 'c', 'd', 'e'];
    const out = deterministicShuffle(orig, 'seed-x');
    expect(out.slice().sort()).toEqual(orig.slice().sort());
  });
});

describe('normalizeAnswer', () => {
  it('lowercases, trims, collapses whitespace', () => {
    expect(normalizeAnswer('  Studies  ')).toBe('studies');
    expect(normalizeAnswer('She  studies\t biology')).toBe(
      'she studies biology',
    );
  });
});

describe('levenshtein', () => {
  it('returns 0 for equal strings', () => {
    expect(levenshtein('studies', 'studies')).toBe(0);
  });
  it('returns 1 for single-char typo', () => {
    expect(levenshtein('studys', 'studies')).toBe(2); // delete 's', insert 'ie'
    expect(levenshtein('studes', 'studies')).toBe(1);
  });
  it('caps at maxDistance+1 for early exit', () => {
    expect(levenshtein('abc', 'xyzwvut', 2)).toBeGreaterThan(2);
  });
});
