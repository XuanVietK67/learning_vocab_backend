import { createReadStream, createWriteStream, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

/**
 * Build a coverage-curated Tatoeba subset for ingest-corpus.ts.
 *
 *   npx ts-node --project tsconfig.seed.json \
 *     src/vocabularies/enrichment/ingest/select-corpus.ts \
 *     <wordlist.csv> <tatoeba.tsv> <out.tsv> [perWord]
 *
 * Instead of taking the first N sentences (random by id), this keeps up to
 * `perWord` good sentences for EACH headword in the EVP word list, so every
 * target word is guaranteed examples while the output stays small. Pure file →
 * file (no DB); the output is in Tatoeba's native `id<TAB>lang<TAB>text` shape,
 * so `ingest-corpus.ts` consumes it unchanged.
 *
 *   - wordlist: the EVP CSV (`headword;pos;CEFR;…`); column 0 is the headword.
 *   - tatoeba:  Tatoeba `sentences.csv` (`id<TAB>iso-639-3<TAB>text`); English rows only.
 *   - out:      curated subset to feed ingest-corpus.ts.
 *   - perWord:  sentences to keep per word (default 5).
 */
const PER_WORD_DEFAULT = 5;
const MIN_WORDS = 4;
const MAX_WORDS = 20;

// Lowercase word tokens (keeps in-word apostrophes: "don't").
function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) ?? [];
}

// Crude inflection → base-form candidates so "studies"/"studying" can match the
// headword "study". Approximate on purpose (Postgres FTS does the real stemming
// at query time); this just needs to FIND decent sentences per word.
function candidates(token: string): string[] {
  const out = [token];
  const n = token.length;
  if (n > 4 && token.endsWith('ies')) out.push(token.slice(0, -3) + 'y');
  if (n > 4 && token.endsWith('ied')) out.push(token.slice(0, -3) + 'y');
  if (n > 3 && token.endsWith('es')) out.push(token.slice(0, -2));
  if (n > 3 && token.endsWith('ed')) out.push(token.slice(0, -2));
  if (n > 4 && token.endsWith('ing')) out.push(token.slice(0, -3));
  if (n > 3 && token.endsWith('s') && !token.endsWith('ss')) {
    out.push(token.slice(0, -1));
  }
  return out;
}

// Lenient "clean enough for a learner" gate; ingest-corpus recomputes the real
// GDEX score on insert and the retrieval orders by it, so this only drops junk.
function isGoodExample(text: string, wordCount: number): boolean {
  if (wordCount < MIN_WORDS || wordCount > MAX_WORDS) return false;
  if (/https?:\/\//i.test(text)) return false;
  if (!/[.!?]["')\]]?$/.test(text.trim())) return false;
  return true;
}

function loadTargets(wordlistPath: string): Set<string> {
  const raw = readFileSync(wordlistPath, 'utf8');
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const targets = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const headword = (line.split(';')[0] ?? '').trim().toLowerCase();
    // Skip the header, blanks, and multi-word entries (a token can't match them).
    if (!headword || headword === 'headword' || /\s/.test(headword)) continue;
    if (!/[a-z]/.test(headword)) continue;
    targets.add(headword);
  }
  return targets;
}

async function main(): Promise<void> {
  const wordlistPath = process.argv[2];
  const tatoebaPath = process.argv[3];
  const outPath = process.argv[4];
  if (!wordlistPath || !tatoebaPath || !outPath) {
    console.error(
      'usage: ts-node select-corpus.ts <wordlist.csv> <tatoeba.tsv> <out.tsv> [perWord]',
    );
    process.exitCode = 1;
    return;
  }
  const perWord = Number(process.argv[5]) || PER_WORD_DEFAULT;

  const targets = loadTargets(wordlistPath);
  const remaining = new Map<string, number>();
  for (const w of targets) remaining.set(w, perWord);
  let needing = remaining.size;

  const out = createWriteStream(outPath, 'utf8');
  const seenText = new Set<string>();
  let read = 0;
  let selected = 0;

  const rl = createInterface({
    input: createReadStream(tatoebaPath, 'utf8'),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    read++;
    const cols = line.split('\t');
    const lang = (cols[1] ?? '').trim();
    const text = (cols[2] ?? '').trim();
    if (lang !== 'eng' || !text) continue;

    const tokens = tokenize(text);
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    if (!isGoodExample(text, wordCount)) continue;

    // Which still-needy target words does this sentence cover?
    const matched = new Set<string>();
    for (const tok of tokens) {
      for (const cand of candidates(tok)) {
        const left = remaining.get(cand);
        if (left !== undefined && left > 0) matched.add(cand);
      }
    }
    if (matched.size === 0) continue;

    const key = text.toLowerCase();
    if (seenText.has(key)) continue;
    seenText.add(key);

    out.write(`${line}\n`);
    selected++;
    for (const w of matched) {
      const left = (remaining.get(w) ?? 0) - 1;
      remaining.set(w, left);
      if (left === 0) needing--;
    }
    if (needing === 0) break;
    if (read % 200000 === 0) {
      console.error(
        `  read ${read}, selected ${selected}, words left ${needing}`,
      );
    }
  }
  out.end();

  let noCoverage = 0;
  for (const left of remaining.values()) if (left === perWord) noCoverage++;
  console.log(
    `select-corpus: read ${read} lines, wrote ${selected} sentences for ` +
      `${targets.size} target words (${perWord}/word); ${noCoverage} words got none.`,
  );
}

void main();
