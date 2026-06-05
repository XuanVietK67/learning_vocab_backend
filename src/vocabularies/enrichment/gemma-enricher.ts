import { ProficiencyLevel } from '@/users/entities/proficiency-level.enum';
import { PartOfSpeech } from '@/vocabularies/entities/part-of-speech.enum';
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
  const obj = parseJsonObject(raw);
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

/** POST a prompt to Gemma's generateContent endpoint and return the text. */
export async function callGemma(
  prompt: string,
  opts: GemmaClientOptions,
): Promise<string> {
  const url = `${opts.baseUrl}/models/${opts.model}:generateContent?key=${opts.apiKey}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    // thinkingBudget: 0 disables the model's hidden reasoning tokens. Without it
    // a thinking model spends the whole output budget on thoughts and truncates
    // the JSON (finishReason MAX_TOKENS). 2048 leaves headroom for the heaviest
    // scratch words (many parts of speech x several senses). See gemma.config.ts.
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 2048,
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
