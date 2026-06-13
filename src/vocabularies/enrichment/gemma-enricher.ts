import { ProficiencyLevel } from '@/users/entities/proficiency-level.enum';
import { PartOfSpeech } from '@/vocabularies/entities/part-of-speech.enum';
import { BatchItemResult } from '@/vocabularies/enrichment/gemma-batcher';
import { mapPartOfSpeech } from '@/vocabularies/enrichment/pos-map';

/**
 * Framework-agnostic Gemma enricher, shared by the enrichment worker. No NestJS,
 * no DB, no DI — just a fetch wrapper plus the prompt builders and defensive JSON
 * parsers (all exported for unit testing). Mirrors the shape discipline of
 * src/practice/gemma-judge.ts (Gemma on AI Studio has no responseSchema/system
 * role, so the schema is embedded in the user prompt and parsed defensively).
 *
 * Two entry points:
 *   - generateExamples: the dictionary already gave us POS + definitions; Gemma
 *     adds a short gloss + >=2 example sentences per sense, and the word's CEFR.
 *   - enrichFromScratch: no dictionary (non-English, or a dictionary miss) —
 *     Gemma produces the whole POS-grouped sense structure. IPA is left null.
 */

export interface GemmaClientOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
}

const VALID_CEFR = new Set<string>(Object.values(ProficiencyLevel));
const GLOSS_MAX = 128;
const DEFINITION_MAX = 2000;
const EXAMPLE_MAX = 1000;
const MAX_EXAMPLES_PER_SENSE = 3;
// Matches the translation column / CreateAdminTranslationDto cap.
const TRANSLATION_MAX = 255;

// ---- generateExamples (dictionary-assisted path) ----

export interface SenseToEnrich {
  definition: string;
}

export interface EnrichExamplesInput {
  lemma: string;
  partOfSpeech: string;
  language: string;
  senses: SenseToEnrich[];
  // When set, Gemma is also asked for a short translation of each sense into
  // this language. Omit (or pass the word's own language) to skip translation.
  translationLanguage?: string;
}

export interface EnrichedSense {
  gloss: string;
  examples: string[];
  // Present only when the request asked for a translation language.
  translation?: string;
}

export interface EnrichExamplesResult {
  cefr: ProficiencyLevel;
  senses: EnrichedSense[];
}

export function buildExamplesPrompt(input: EnrichExamplesInput): string {
  const senseList = input.senses
    .map((s, i) => `${i + 1}. ${s.definition}`)
    .join('\n');

  const t = input.translationLanguage;
  const translationInstruction = t
    ? `\n- "translation": a short translation (1-3 words) of "${input.lemma}" for THAT sense, written in language "${t}".`
    : '';
  const translationField = t ? `, "translation": "<short translation>"` : '';

  return `You help build a language-learning dictionary. The target word is "${input.lemma}" used as a ${input.partOfSpeech}. Example sentences must be written in language code "${input.language}".

Here are ${input.senses.length} numbered sense(s) of the word:
${senseList}

For EACH sense, in the same order, produce:
- "gloss": a very short label of 1-4 words summarising that sense.
- "examples": an array of at least 2 natural sentences that use "${input.lemma}" (or an inflected form) with THAT sense, written in language "${input.language}".${translationInstruction}

Also estimate "cefr": the overall CEFR difficulty of the word itself (A1, A2, B1, B2, C1, or C2).

Reply with ONLY a JSON object (no markdown, no prose) of exactly this shape:
{
  "cefr": "<A1|A2|B1|B2|C1|C2>",
  "senses": [
    { "gloss": "<short label>", "examples": ["<sentence>", "<sentence>"]${translationField} }
  ]
}
The "senses" array MUST have exactly ${input.senses.length} item(s), one per numbered sense above, in order.`;
}

export function parseExamplesResponse(
  raw: string,
  expectedCount: number,
): EnrichExamplesResult {
  const obj = parseJsonObject(raw);
  const cefr = coerceCefr(obj.cefr);
  const sensesRaw = Array.isArray(obj.senses) ? obj.senses : [];
  if (sensesRaw.length < expectedCount) {
    throw new Error(
      `enricher returned ${sensesRaw.length} senses, expected ${expectedCount}`,
    );
  }

  const senses: EnrichedSense[] = [];
  for (let i = 0; i < expectedCount; i++) {
    const s = (sensesRaw[i] ?? {}) as Record<string, unknown>;
    const examples = coerceExamples(s.examples);
    if (examples.length < 2) {
      throw new Error(`sense ${i + 1} returned fewer than 2 examples`);
    }
    senses.push({
      gloss: coerceGloss(s.gloss),
      examples,
      translation: coerceTranslation(s.translation),
    });
  }
  return { cefr, senses };
}

// ---- enrichFromScratch (Gemma-only fallback path) ----

export interface ScratchSense {
  gloss: string;
  definition: string;
  examples: string[];
  // Present only when the request asked for a translation language.
  translation?: string;
}

export interface ScratchPosGroup {
  partOfSpeech: PartOfSpeech;
  cefr: ProficiencyLevel;
  senses: ScratchSense[];
}

export function buildScratchPrompt(
  lemma: string,
  language: string,
  translationLanguage?: string,
): string {
  const t = translationLanguage;
  const translationInstruction = t
    ? ` Also give a short "translation" (1-3 words) of "${lemma}" for that sense, written in language "${t}".`
    : '';
  const translationField = t ? `, "translation": "<short translation>"` : '';

  return `You help build a language-learning dictionary for language code "${language}". Describe the word "${lemma}".

For each part of speech the word can have (noun, verb, adjective, adverb, pronoun, preposition, conjunction, interjection, phrase), give 1-3 of its most common senses. For each sense provide a short "gloss" (1-4 words), a learner-friendly "definition", and at least 2 natural "examples" sentences in language "${language}" that use "${lemma}" (or an inflected form).${translationInstruction}

Also give "cefr": the overall CEFR difficulty of the word (A1, A2, B1, B2, C1, or C2).

Reply with ONLY a JSON object (no markdown, no prose) of exactly this shape:
{
  "cefr": "<A1|A2|B1|B2|C1|C2>",
  "partsOfSpeech": [
    {
      "partOfSpeech": "<noun|verb|adjective|adverb|pronoun|preposition|conjunction|interjection|phrase>",
      "senses": [
        { "gloss": "<short label>", "definition": "<definition>", "examples": ["<sentence>", "<sentence>"]${translationField} }
      ]
    }
  ]
}`;
}

export function parseScratchResponse(raw: string): ScratchPosGroup[] {
  return parsePosGroupsFromWord(parseJsonObject(raw));
}

// Parse one word object ({ cefr, partsOfSpeech: [...] }) into POS groups.
// Shared by the single-word and batched scratch parsers so they stay in lockstep.
function parsePosGroupsFromWord(
  obj: Record<string, unknown>,
): ScratchPosGroup[] {
  const cefr = coerceCefr(obj.cefr);
  const groupsRaw = Array.isArray(obj.partsOfSpeech) ? obj.partsOfSpeech : [];

  const groups: ScratchPosGroup[] = [];
  for (const gRaw of groupsRaw) {
    const g = (gRaw ?? {}) as Record<string, unknown>;
    const pos =
      typeof g.partOfSpeech === 'string'
        ? mapPartOfSpeech(g.partOfSpeech)
        : null;
    if (!pos) continue;

    const sensesRaw = Array.isArray(g.senses) ? g.senses : [];
    const senses: ScratchSense[] = [];
    for (const sRaw of sensesRaw) {
      const s = (sRaw ?? {}) as Record<string, unknown>;
      const definition =
        typeof s.definition === 'string' ? s.definition.trim() : '';
      const examples = coerceExamples(s.examples);
      if (!definition || examples.length < 2) continue;
      senses.push({
        gloss: coerceGloss(s.gloss),
        definition: definition.slice(0, DEFINITION_MAX),
        examples,
        translation: coerceTranslation(s.translation),
      });
    }
    if (senses.length > 0) groups.push({ partOfSpeech: pos, cefr, senses });
  }
  return groups;
}

// ---- network ----

interface GenerateContentResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}

/**
 * POST a prompt to Gemma's generateContent endpoint and return the text.
 * `maxOutputTokens` defaults to a single-word budget; the batched callers raise
 * it so a 5-word response isn't truncated (finishReason MAX_TOKENS).
 */
export async function callGemma(
  prompt: string,
  opts: GemmaClientOptions,
  maxOutputTokens = 2048,
): Promise<string> {
  const url = `${opts.baseUrl}/models/${opts.model}:generateContent?key=${opts.apiKey}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    // thinkingBudget: 0 disables the model's hidden reasoning tokens. Without it
    // a thinking model spends the whole output budget on thoughts and truncates
    // the JSON (finishReason MAX_TOKENS). The default budget leaves headroom for
    // the heaviest scratch words (many parts of speech x several senses); batched
    // callers pass a larger value. See gemma.config.ts.
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens,
      thinkingConfig: { thinkingBudget: 0 },
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`gemma ${res.status}: ${detail.slice(0, 200)}`);
  }

  const data = (await res.json()) as GenerateContentResponse;
  const text = data.candidates?.[0]?.content?.parts
    ?.map((p) => p.text ?? '')
    .join('')
    .trim();
  if (!text) throw new Error('gemma returned an empty response');
  return text;
}

export async function generateExamples(
  input: EnrichExamplesInput,
  opts: GemmaClientOptions,
): Promise<EnrichExamplesResult> {
  const text = await callGemma(buildExamplesPrompt(input), opts);
  return parseExamplesResponse(text, input.senses.length);
}

export async function enrichFromScratch(
  lemma: string,
  language: string,
  opts: GemmaClientOptions,
  translationLanguage?: string,
): Promise<ScratchPosGroup[]> {
  const text = await callGemma(
    buildScratchPrompt(lemma, language, translationLanguage),
    opts,
  );
  return parseScratchResponse(text);
}

// ---- batched entry points (one model call for up to N words) ----
//
// Both return one BatchItemResult per input word, in input order, parsed
// independently so one malformed word can't poison the batch. Words are matched
// to the response by the echoed "lemma" (case-insensitive), falling back to
// position. The whole call throwing (network/429/unparseable batch) propagates,
// so the batcher can fail every participant and let each job retry alone.

export interface BatchExamplesPosInput {
  partOfSpeech: PartOfSpeech;
  senses: SenseToEnrich[];
}

export interface BatchExamplesWordInput {
  lemma: string;
  language: string;
  translationLanguage?: string;
  posGroups: BatchExamplesPosInput[];
}

export interface BatchExamplesPosResult {
  partOfSpeech: PartOfSpeech;
  senses: EnrichedSense[];
}

export interface BatchExamplesWordResult {
  cefr: ProficiencyLevel;
  posGroups: BatchExamplesPosResult[];
}

export interface BatchScratchWordInput {
  lemma: string;
  language: string;
  translationLanguage?: string;
}

// Output token budget for a batch: enough headroom per word to avoid truncation,
// capped so one call can't run away. ~1 word ≈ the single-word default.
function batchTokenBudget(count: number): number {
  return Math.min(8192, 1024 + 1280 * Math.max(1, count));
}

export function buildBatchExamplesPrompt(
  words: BatchExamplesWordInput[],
): string {
  const language = words[0]?.language ?? 'en';
  const t = words[0]?.translationLanguage;

  const wordBlocks = words
    .map((w, wi) => {
      const posBlocks = w.posGroups
        .map((g) => {
          const senseLines = g.senses
            .map((s, si) => `    ${si + 1}. ${s.definition}`)
            .join('\n');
          return `  As ${g.partOfSpeech}:\n${senseLines}`;
        })
        .join('\n');
      return `Word ${wi + 1}: "${w.lemma}"\n${posBlocks}`;
    })
    .join('\n\n');

  const translationInstruction = t
    ? `\n- "translation": a short translation (1-3 words) of the word for THAT sense, written in language "${t}".`
    : '';
  const translationField = t ? `, "translation": "<short translation>"` : '';

  return `You help build a language-learning dictionary. Example sentences must be written in language code "${language}". Below are ${words.length} word(s); each lists its part(s) of speech, and under each, numbered sense definitions.

${wordBlocks}

For EACH word, EACH of its parts of speech, and EACH numbered sense (in the same order), produce:
- "gloss": a very short label of 1-4 words summarising that sense.
- "examples": an array of at least 2 natural sentences that use the word (or an inflected form) with THAT sense, written in language "${language}".${translationInstruction}
Also estimate "cefr": the overall CEFR difficulty of each word (A1, A2, B1, B2, C1, or C2).

Reply with ONLY a JSON object (no markdown, no prose) of exactly this shape:
{
  "words": [
    {
      "lemma": "<the word>",
      "cefr": "<A1|A2|B1|B2|C1|C2>",
      "partsOfSpeech": [
        { "partOfSpeech": "<the part of speech>", "senses": [ { "gloss": "<short label>", "examples": ["<sentence>", "<sentence>"]${translationField} } ] }
      ]
    }
  ]
}
The "words" array MUST have exactly ${words.length} item(s), one per word above, echoing each "lemma".`;
}

export function parseBatchExamplesResponse(
  raw: string,
  words: BatchExamplesWordInput[],
): BatchItemResult<BatchExamplesWordResult>[] {
  const indexed = indexWordsByLemma(parseJsonObject(raw));

  return words.map((word, wi) => {
    const wordObj =
      indexed.byLemma.get(word.lemma.trim().toLowerCase()) ?? indexed.list[wi];
    if (!wordObj) {
      return batchError(`no result returned for "${word.lemma}"`);
    }
    try {
      const cefr = coerceCefr(wordObj.cefr);
      const posList = (
        Array.isArray(wordObj.partsOfSpeech) ? wordObj.partsOfSpeech : []
      ).filter(isObject);
      const posByLabel = new Map<string, Record<string, unknown>>();
      for (const p of posList) {
        const label =
          typeof p.partOfSpeech === 'string'
            ? p.partOfSpeech.trim().toLowerCase()
            : '';
        if (label && !posByLabel.has(label)) posByLabel.set(label, p);
      }

      const posGroups: BatchExamplesPosResult[] = word.posGroups.map(
        (inGroup, gi) => {
          const respGroup =
            posByLabel.get(inGroup.partOfSpeech.toLowerCase()) ?? posList[gi];
          if (!respGroup) {
            throw new Error(
              `missing part of speech "${inGroup.partOfSpeech}" for "${word.lemma}"`,
            );
          }
          const sensesRaw = Array.isArray(respGroup.senses)
            ? respGroup.senses
            : [];
          if (sensesRaw.length < inGroup.senses.length) {
            throw new Error(
              `"${word.lemma}" (${inGroup.partOfSpeech}) returned ${sensesRaw.length} senses, expected ${inGroup.senses.length}`,
            );
          }
          const senses: EnrichedSense[] = inGroup.senses.map((_, si) => {
            const s = (sensesRaw[si] ?? {}) as Record<string, unknown>;
            const examples = coerceExamples(s.examples);
            if (examples.length < 2) {
              throw new Error(
                `"${word.lemma}" (${inGroup.partOfSpeech}) sense ${si + 1} returned fewer than 2 examples`,
              );
            }
            return {
              gloss: coerceGloss(s.gloss),
              examples,
              translation: coerceTranslation(s.translation),
            };
          });
          return { partOfSpeech: inGroup.partOfSpeech, senses };
        },
      );

      return { ok: true, value: { cefr, posGroups } };
    } catch (err) {
      return batchError(err);
    }
  });
}

export async function generateBatchExamples(
  words: BatchExamplesWordInput[],
  opts: GemmaClientOptions,
): Promise<BatchItemResult<BatchExamplesWordResult>[]> {
  if (words.length === 0) return [];
  const text = await callGemma(
    buildBatchExamplesPrompt(words),
    opts,
    batchTokenBudget(words.length),
  );
  return parseBatchExamplesResponse(text, words);
}

export function buildBatchScratchPrompt(
  words: BatchScratchWordInput[],
): string {
  const language = words[0]?.language ?? 'en';
  const t = words[0]?.translationLanguage;
  const wordList = words.map((w, i) => `${i + 1}. "${w.lemma}"`).join('\n');

  const translationInstruction = t
    ? ` Also give a short "translation" (1-3 words) of the word for that sense, written in language "${t}".`
    : '';
  const translationField = t ? `, "translation": "<short translation>"` : '';

  return `You help build a language-learning dictionary for language code "${language}". Describe each of the following ${words.length} word(s):
${wordList}

For each word, for each part of speech it can have (noun, verb, adjective, adverb, pronoun, preposition, conjunction, interjection, phrase), give 1-3 of its most common senses. For each sense provide a short "gloss" (1-4 words), a learner-friendly "definition", and at least 2 natural "examples" sentences in language "${language}" that use the word (or an inflected form).${translationInstruction} Also give "cefr": the overall CEFR difficulty of the word (A1, A2, B1, B2, C1, or C2).

Reply with ONLY a JSON object (no markdown, no prose) of exactly this shape:
{
  "words": [
    {
      "lemma": "<the word>",
      "cefr": "<A1|A2|B1|B2|C1|C2>",
      "partsOfSpeech": [
        {
          "partOfSpeech": "<noun|verb|adjective|adverb|pronoun|preposition|conjunction|interjection|phrase>",
          "senses": [ { "gloss": "<short label>", "definition": "<definition>", "examples": ["<sentence>", "<sentence>"]${translationField} } ]
        }
      ]
    }
  ]
}
The "words" array MUST have exactly ${words.length} item(s), one per word above, echoing each "lemma".`;
}

export function parseBatchScratchResponse(
  raw: string,
  lemmas: string[],
): BatchItemResult<ScratchPosGroup[]>[] {
  const indexed = indexWordsByLemma(parseJsonObject(raw));

  return lemmas.map((lemma, i) => {
    const wordObj =
      indexed.byLemma.get(lemma.trim().toLowerCase()) ?? indexed.list[i];
    if (!wordObj) {
      return batchError(`no result returned for "${lemma}"`);
    }
    try {
      const groups = parsePosGroupsFromWord(wordObj);
      if (groups.length === 0) {
        return batchError(`"${lemma}" produced no usable senses`);
      }
      return { ok: true, value: groups };
    } catch (err) {
      return batchError(err);
    }
  });
}

export async function generateBatchScratch(
  words: BatchScratchWordInput[],
  opts: GemmaClientOptions,
): Promise<BatchItemResult<ScratchPosGroup[]>[]> {
  if (words.length === 0) return [];
  const text = await callGemma(
    buildBatchScratchPrompt(words),
    opts,
    batchTokenBudget(words.length),
  );
  return parseBatchScratchResponse(
    text,
    words.map((w) => w.lemma),
  );
}

// ---- shared coercion helpers ----

function coerceCefr(value: unknown): ProficiencyLevel {
  const cefr = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!VALID_CEFR.has(cefr)) {
    throw new Error(`enricher returned invalid cefr: ${cefr || typeof value}`);
  }
  return cefr as ProficiencyLevel;
}

function coerceGloss(value: unknown): string {
  const gloss = typeof value === 'string' ? value.trim() : '';
  return gloss.slice(0, GLOSS_MAX);
}

// Optional: a missing/blank translation is fine (the request may not have asked
// for one, or the model omitted it) — callers only persist a translation when a
// non-empty value comes back.
function coerceTranslation(value: unknown): string | undefined {
  const translation = typeof value === 'string' ? value.trim() : '';
  return translation ? translation.slice(0, TRANSLATION_MAX) : undefined;
}

function coerceExamples(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map((v) => v.trim().slice(0, EXAMPLE_MAX))
    .slice(0, MAX_EXAMPLES_PER_SENSE);
}

// Pull a JSON object out of the model text: strip ```/```json fences, then fall
// back to the first '{' … last '}' span if there is surrounding prose.
function parseJsonObject(raw: string): Record<string, unknown> {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  if (!(text.startsWith('{') && text.endsWith('}'))) {
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first !== -1 && last > first) text = text.slice(first, last + 1);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('enricher did not return valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('enricher JSON was not an object');
  }
  return parsed as Record<string, unknown>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Wrap a reason (string or thrown value) as a failed batch item.
function batchError(reason: unknown): { ok: false; error: Error } {
  const error =
    reason instanceof Error
      ? reason
      : new Error(typeof reason === 'string' ? reason : String(reason));
  return { ok: false, error };
}

// Index a batched `{ words: [...] }` response: keep the list (for positional
// fallback) and a lemma -> word-object map (for robust matching when the model
// reorders or omits words). First occurrence of a lemma wins.
function indexWordsByLemma(obj: Record<string, unknown>): {
  list: Record<string, unknown>[];
  byLemma: Map<string, Record<string, unknown>>;
} {
  const list = (Array.isArray(obj.words) ? obj.words : []).filter(isObject);
  const byLemma = new Map<string, Record<string, unknown>>();
  for (const w of list) {
    const lemma =
      typeof w.lemma === 'string' ? w.lemma.trim().toLowerCase() : '';
    if (lemma && !byLemma.has(lemma)) byLemma.set(lemma, w);
  }
  return { list, byLemma };
}
