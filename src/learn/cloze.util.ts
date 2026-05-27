import { PartOfSpeech } from '@/vocabularies/entities/part-of-speech.enum';

export const BLANK = '_____';

export interface ClozeResult {
  sentenceWithBlank: string;
  blankedForm: string; // the exact inflected form replaced by BLANK
}

// Try to locate the lemma in `sentence` and replace its first occurrence
// with BLANK. The match is case-insensitive and tolerates simple English
// inflections (verb: -s/-es/-ed/-d/-ied/-ing; noun: -s/-es/-ies). If no
// match is found, returns null — caller should try another example.
export function buildCloze(
  sentence: string,
  lemma: string,
  pos: PartOfSpeech,
): ClozeResult | null {
  const forms = expandForms(lemma, pos);
  for (const form of forms) {
    // \b doesn't match across apostrophes the same in every locale, so we
    // use a manual word-boundary regex: (^|\W) before and (\W|$) after.
    const re = new RegExp(`(^|\\W)(${escapeRegex(form)})(\\W|$)`, 'i');
    const m = re.exec(sentence);
    if (m) {
      const matchedForm = m[2];
      const before = sentence.slice(0, m.index + m[1].length);
      const after = sentence.slice(m.index + m[1].length + matchedForm.length);
      return {
        sentenceWithBlank: `${before}${BLANK}${after}`,
        blankedForm: matchedForm,
      };
    }
  }
  return null;
}

// Returns the span [start, end) of the first occurrence (any inflected form)
// of the lemma in the sentence, or null if absent.
export function findLemmaSpan(
  sentence: string,
  lemma: string,
  pos: PartOfSpeech,
): { start: number; end: number; form: string } | null {
  const forms = expandForms(lemma, pos);
  for (const form of forms) {
    const re = new RegExp(`(^|\\W)(${escapeRegex(form)})(\\W|$)`, 'i');
    const m = re.exec(sentence);
    if (m) {
      const start = m.index + m[1].length;
      return { start, end: start + m[2].length, form: m[2] };
    }
  }
  return null;
}

function expandForms(lemma: string, pos: PartOfSpeech): string[] {
  const base = lemma.toLowerCase();
  const set = new Set<string>([base]);

  if (pos === PartOfSpeech.VERB) {
    // -s / -es
    if (endsIn(base, 's', 'sh', 'ch', 'x', 'z')) set.add(`${base}es`);
    else if (base.endsWith('y') && !isVowel(base[base.length - 2])) {
      set.add(`${base.slice(0, -1)}ies`);
    } else {
      set.add(`${base}s`);
    }
    // -ed / -d / -ied
    if (base.endsWith('e')) set.add(`${base}d`);
    else if (base.endsWith('y') && !isVowel(base[base.length - 2])) {
      set.add(`${base.slice(0, -1)}ied`);
    } else {
      set.add(`${base}ed`);
    }
    // -ing
    if (base.endsWith('e') && !base.endsWith('ee') && !base.endsWith('ye')) {
      set.add(`${base.slice(0, -1)}ing`);
    } else {
      set.add(`${base}ing`);
    }
  } else if (pos === PartOfSpeech.NOUN) {
    if (endsIn(base, 's', 'sh', 'ch', 'x', 'z')) set.add(`${base}es`);
    else if (base.endsWith('y') && !isVowel(base[base.length - 2])) {
      set.add(`${base.slice(0, -1)}ies`);
    } else {
      set.add(`${base}s`);
    }
  }
  // For other POS we only try the lemma itself; inflection is rare or hard
  // to predict reliably (adjectives, adverbs, etc.).
  return Array.from(set);
}

function endsIn(s: string, ...suffixes: string[]): boolean {
  return suffixes.some((sfx) => s.endsWith(sfx));
}

function isVowel(ch: string | undefined): boolean {
  return ch != null && 'aeiou'.includes(ch);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Whitespace-tokenize a sentence for the sentence-build question. We split
// on runs of whitespace; trailing punctuation stays attached to the token
// it belongs to (so "She studies biology." → ["She", "studies", "biology."]).
export function tokenizeSentence(sentence: string): string[] {
  return sentence.trim().split(/\s+/);
}

// Deterministic shuffle keyed by `seed` so the same sentence yields the same
// scramble for the same session item. Uses a simple xorshift PRNG.
export function deterministicShuffle<T>(arr: T[], seed: string): T[] {
  const out = arr.slice();
  let state = hashSeed(seed) || 1;
  for (let i = out.length - 1; i > 0; i--) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    const j = Math.abs(state) % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function hashSeed(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return h;
}

// Normalize a typed answer for comparison: NFC, lowercase, trim, collapse
// inner whitespace. Used by the typing/build graders and (re-)derived
// equality checks.
export function normalizeAnswer(s: string): string {
  return s.normalize('NFC').toLowerCase().trim().replace(/\s+/g, ' ');
}

// Levenshtein distance (capped at maxDistance for early exit).
export function levenshtein(a: string, b: string, maxDistance = 3): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > maxDistance) return maxDistance + 1;
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}
