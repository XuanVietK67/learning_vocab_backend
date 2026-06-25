import {
  ChatMessage,
  chatCompletion,
  GroqRequestOptions,
} from '@/common/groq/groq-request';
import { ProficiencyLevel } from '@/users/entities/proficiency-level.enum';

/**
 * Framework-agnostic scenario draft helper for the admin authoring flow. No
 * NestJS, no DB, no DI — just a Groq fetch wrapper plus the prompt builder and
 * the defensive JSON parser (both exported for unit testing). Mirrors the shape
 * of practice/gemma-judge.ts.
 *
 * Given a short brief ("café ordering, B1") it returns a complete, *unsaved*
 * scenario spec for the admin to review and edit before creating. The output
 * fields line up with CreateScenarioDto so the frontend can prefill the form.
 */

export type ScenarioDraftOptions = GroqRequestOptions;

export interface ScenarioDraftInput {
  // Free-text brief, e.g. "café ordering, B1" or "job interview for a developer".
  brief: string;
  // Optional hard constraints the admin set in the form; when present they
  // override whatever the brief implies.
  cefrLevel?: ProficiencyLevel | null;
  topic?: string | null;
}

// The drafted spec. Mirrors CreateScenarioDto; not persisted by this module.
export interface ScenarioDraft {
  title: string;
  topic: string;
  cefrLevel: ProficiencyLevel | null;
  setting: string;
  aiRole: string;
  userRole: string;
  goal: string;
  openingLine: string;
  seedPhrases: string[];
  estTurns: number | null;
  introVideoScript: string | null;
}

const VALID_CEFR = new Set<string>(Object.values(ProficiencyLevel));

/** Build the messages for the draft request. Groq supports a system role. */
export function buildDraftMessages(input: ScenarioDraftInput): ChatMessage[] {
  const constraints: string[] = [];
  if (input.cefrLevel) {
    constraints.push(`- The CEFR level MUST be exactly "${input.cefrLevel}".`);
  }
  if (input.topic) {
    constraints.push(`- The topic slug MUST be exactly "${input.topic}".`);
  }
  const constraintBlock =
    constraints.length > 0
      ? `\nHard constraints (do not deviate):\n${constraints.join('\n')}\n`
      : '';

  const system = `You are an expert ESL curriculum designer. You create reusable, role-play speaking-practice scenarios for a learner to practise spoken English with an AI partner. The learner's native language is Vietnamese. Keep the scenario realistic, encouraging, and achievable in a short conversation.`;

  const user = `Draft a single speaking-practice scenario from this brief:
"""${input.brief}"""
${constraintBlock}
Reply with ONLY a JSON object (no markdown, no prose) of exactly this shape:
{
  "title": "<short human title, e.g. Ordering at a café>",
  "topic": "<one lowercase slug: letters, digits, hyphens only, e.g. food>",
  "cefrLevel": "<one of A1, A2, B1, B2, C1, C2, or null for any level>",
  "setting": "<1-3 sentences describing the scene>",
  "aiRole": "<the AI partner's character, e.g. barista>",
  "userRole": "<the learner's character, e.g. customer>",
  "goal": "<what the learner should accomplish in the conversation>",
  "openingLine": "<the first thing the AI says, in character>",
  "seedPhrases": ["<3-6 anchor phrases / key vocab for this topic>"],
  "estTurns": <rough number of back-and-forth turns, integer 4-20>,
  "introVideoScript": "<2-4 sentence cinematic scene-setting narration, or null>"
}`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/**
 * Parse and validate the model's text into a ScenarioDraft. Strips markdown
 * fences, tolerates surrounding prose, slugifies the topic, coerces the CEFR
 * level (invalid/missing → null = any), and clamps estTurns. Throws when a
 * required string field is missing so the caller can surface a clear error.
 */
export function parseScenarioDraft(raw: string): ScenarioDraft {
  const json = extractJsonObject(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('draft model did not return valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('draft JSON was not an object');
  }
  const obj = parsed as Record<string, unknown>;

  const title = requireString(obj.title, 'title');
  const setting = requireString(obj.setting, 'setting');
  const aiRole = requireString(obj.aiRole, 'aiRole');
  const userRole = requireString(obj.userRole, 'userRole');
  const goal = requireString(obj.goal, 'goal');
  const openingLine = requireString(obj.openingLine, 'openingLine');

  const topic = slugify(typeof obj.topic === 'string' ? obj.topic : '');
  if (!topic) {
    throw new Error('draft returned an empty topic');
  }

  const cefrRaw =
    typeof obj.cefrLevel === 'string' ? obj.cefrLevel.trim().toUpperCase() : '';
  const cefrLevel = VALID_CEFR.has(cefrRaw)
    ? (cefrRaw as ProficiencyLevel)
    : null;

  const seedPhrases = Array.isArray(obj.seedPhrases)
    ? obj.seedPhrases
        .filter((p): p is string => typeof p === 'string')
        .map((p) => p.trim())
        .filter((p) => p.length > 0)
        .slice(0, 20)
    : [];

  const estTurns = clampIntOrNull(obj.estTurns, 1, 100);

  const introVideoScript =
    typeof obj.introVideoScript === 'string' && obj.introVideoScript.trim()
      ? obj.introVideoScript.trim()
      : null;

  return {
    title,
    topic,
    cefrLevel,
    setting,
    aiRole,
    userRole,
    goal,
    openingLine,
    seedPhrases,
    estTurns,
    introVideoScript,
  };
}

/**
 * Draft one scenario. Resolves to the spec + the model name. Throws on network
 * error, non-2xx, timeout, or an unparseable spec. Key rotation lives in
 * common/groq/groq-request.ts.
 */
export async function draftScenario(
  input: ScenarioDraftInput,
  opts: ScenarioDraftOptions,
): Promise<{ draft: ScenarioDraft; model: string }> {
  const text = await chatCompletion(opts, {
    messages: buildDraftMessages(input),
    temperature: 0.8,
    maxTokens: 1024,
    jsonMode: true,
  });

  return { draft: parseScenarioDraft(text), model: opts.model };
}

function requireString(value: unknown, field: string): string {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s) throw new Error(`draft is missing required field: ${field}`);
  return s;
}

// Normalise an arbitrary topic string into the slug shape CreateScenarioDto
// enforces: lowercase letters, digits, single hyphens, no leading/trailing -.
function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function clampIntOrNull(
  value: unknown,
  min: number,
  max: number,
): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
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
