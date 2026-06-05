import { normalizeLemmas } from '@/vocabularies/enrichment/import/normalize';

describe('normalizeLemmas', () => {
  it('trims, drops empties, and case-insensitively dedupes (keeping first form)', () => {
    const r = normalizeLemmas(['Run', ' run ', 'RUN', '', '  ', 'jump'], 100);
    expect(r.lemmas).toEqual(['Run', 'jump']);
    expect(r.deduped).toBe(2);
    expect(r.capped).toBe(false);
  });

  it('drops entries longer than 128 chars', () => {
    const long = 'a'.repeat(129);
    const r = normalizeLemmas([long, 'ok'], 100);
    expect(r.lemmas).toEqual(['ok']);
  });

  it('caps the result and flags capped', () => {
    const r = normalizeLemmas(['a', 'b', 'c', 'd'], 2);
    expect(r.lemmas).toEqual(['a', 'b']);
    expect(r.capped).toBe(true);
  });
});
