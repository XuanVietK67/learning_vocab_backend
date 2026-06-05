import { ProductionRubric } from '@/practice/rubric.types';
import { ProficiencyLevel } from '@/users/entities/proficiency-level.enum';

/**
 * Framework-agnostic Gemma judge, shared by the practice-scoring worker. No
 * NestJS, no DB, no DI — just a fetch wrapper plus the prompt builder and the
 * defensive JSON parser (both exported for unit testing).
 *
 * Targets Google AI Studio's generateContent endpoint. Gemma on AI Studio has
 * no `responseSchema`/system-instruction support, so the rubric schema is
 * embedded in the user prompt and the response is parsed defensively.
 */

export interface GemmaJudgeOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
}

export interface JudgeInput {
  lemma: string;
  partOfSpeech?: string | null;
  // Sense glosses so the judge knows the intended meaning of a polysemous word.
  senseGlosses: string[];
  // The user's sentence (typed, or a speech-to-text transcript).
  sentence: string;
}

const VALID_CEFR = new Set<string>(Object.values(ProficiencyLevel));

/** Build the judge prompt. Everything goes in the user turn (Gemma has no system role). */
export function buildJudgePrompt(input: JudgeInput): string {
  const glosses =
    input.senseGlosses.length > 0
      ? input.senseGlosses.map((g) => `- ${g}`).join('\n')
      : '- (no glosses available)';
  const pos = input.partOfSpeech ? ` (${input.partOfSpeech})` : '';

  return `You are an English teacher grading one sentence a learner wrote to practise a target word.

Target word: "${input.lemma}"${pos}
Intended meaning(s) of the target word:
${glosses}

Learner's sentence:
"""${input.sentence}"""

Grade ONLY this sentence. Judge whether the target word (or an inflected form) is present and used with one of the intended meanings, then rate grammar, word usage, naturalness, and relevance.

Also estimate the CEFR level the sentence itself DEMONSTRATES (A1, A2, B1, B2, C1, or C2) — this is the level of the language in the sentence, NOT the learner's overall ability. A perfectly correct but very simple sentence is low CEFR.

Reply with ONLY a JSON object (no markdown, no prose) of exactly this shape:
{
  "overall": <integer 0-100>,
  "usesTargetWord": <boolean>,
  "correctUsage": <boolean>,
  "criteria": {
    "grammar": <integer 0-5>,
    "wordUsage": <integer 0-5>,
    "naturalness": <integer 0-5>,
    "relevance": <integer 0-5>
  },
  "cefr": "<A1|A2|B1|B2|C1|C2>",
  "feedback": "<one or two short sentences of feedback for the learner>",
  "correctedSentence": "<an improved version, or omit if already good>"
}`;
}

/**
 * Parse and validate the model's text into a ProductionRubric. Strips markdown
 * fences, tolerates surrounding prose, clamps numeric ranges, and rejects a
 * missing/invalid CEFR (so the worker retries rather than storing garbage).
 * Throws on anything it cannot coerce into a valid rubric.
 */
export function parseRubric(raw: string): ProductionRubric {
  const json = extractJsonObject(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('judge did not return valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('judge JSON was not an object');
  }
  const obj = parsed as Record<string, unknown>;
  const criteria = (obj.criteria ?? {}) as Record<string, unknown>;

  const cefr =
    typeof obj.cefr === 'string' ? obj.cefr.trim().toUpperCase() : '';
  if (!VALID_CEFR.has(cefr)) {
    throw new Error(`judge returned invalid cefr: ${cefr || typeof obj.cefr}`);
  }

  const feedback = typeof obj.feedback === 'string' ? obj.feedback.trim() : '';
  if (!feedback) {
    throw new Error('judge returned empty feedback');
  }

  const corrected =
    typeof obj.correctedSentence === 'string' && obj.correctedSentence.trim()
      ? obj.correctedSentence.trim()
      : undefined;

  return {
    overall: clampInt(obj.overall, 0, 100),
    usesTargetWord: Boolean(obj.usesTargetWord),
    correctUsage: Boolean(obj.correctUsage),
    criteria: {
      grammar: clampInt(criteria.grammar, 0, 5),
      wordUsage: clampInt(criteria.wordUsage, 0, 5),
      naturalness: clampInt(criteria.naturalness, 0, 5),
      relevance: clampInt(criteria.relevance, 0, 5),
    },
    cefr: cefr as ProficiencyLevel,
    feedback,
    ...(corrected ? { correctedSentence: corrected } : {}),
  };
}

function clampInt(value: unknown, min: number, max: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.round(n)));
}

// Pull the JSON object out of the model text: strip ```/```json fences, then
// fall back to the first '{' … last '}' span if there is surrounding prose.
function extractJsonObject(raw: string): string {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  if (text.startsWith('{') && text.endsWith('}')) return text;
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) return text.slice(first, last + 1);
  return text;
}

interface GenerateContentResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}

/**
 * Score one sentence. Resolves to the rubric + the model name. Throws on
 * network error, non-2xx (including 429 rate-limit — the caller turns that into
 * a BullMQ retry), timeout, or an unparseable rubric.
 */
export async function scoreSentence(
  input: JudgeInput,
  opts: GemmaJudgeOptions,
): Promise<{ rubric: ProductionRubric; model: string }> {
  const url = `${opts.baseUrl}/models/${opts.model}:generateContent?key=${opts.apiKey}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: buildJudgePrompt(input) }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 512 },
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

  return { rubric: parseRubric(text), model: opts.model };
}
