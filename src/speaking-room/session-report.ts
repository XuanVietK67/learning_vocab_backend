import {
  ChatMessage,
  chatCompletion,
  GroqRequestOptions,
} from '@/common/groq/groq-request';
import {
  optionalString,
  parseJsonObject,
  requireString,
  stringArray,
} from '@/speaking-room/llm-json';
import { Correction, SessionReport } from '@/speaking-room/speaking-room.types';
import { ProficiencyLevel } from '@/users/entities/proficiency-level.enum';

/**
 * Framework-agnostic core for the end-of-session feedback report: one slower LLM
 * call over the full transcript (use a smarter model than the live turns — plan
 * §3 Phase 2.4). No NestJS, no DB. Prompt builder + parser exported for tests.
 */

const VALID_CEFR = new Set<string>(Object.values(ProficiencyLevel));

// The fixed context the report is written against.
export interface ReportContext {
  aiRole: string;
  userRole: string;
  setting: string;
  goal: string;
  cefrLevel: ProficiencyLevel | null;
  // Words the learner set out to practise (used to compute used vs. missed).
  selectedWords: string[];
}

// One transcript line fed to the report. AI lines give the conversation shape;
// user lines are what gets assessed.
export interface ReportTurn {
  role: 'ai' | 'user';
  text: string;
}

/** Build the chat messages for the report request. */
export function buildReportMessages(
  ctx: ReportContext,
  transcript: ReportTurn[],
): ChatMessage[] {
  const level = ctx.cefrLevel ? `${ctx.cefrLevel} (CEFR)` : 'unspecified';
  const targetWords =
    ctx.selectedWords.length > 0 ? ctx.selectedWords.join(', ') : '(none set)';
  const lines = transcript
    .map((t) => `${t.role === 'ai' ? ctx.aiRole : ctx.userRole}: ${t.text}`)
    .join('\n');

  const system = `You are a supportive ESL speaking coach. You review a finished role-play conversation between an AI partner and a Vietnamese learner of English, then write a short, encouraging feedback report. Be specific and kind; never overwhelm the learner.`;

  const user = `Scenario: ${ctx.setting}
The AI played ${ctx.aiRole}; the learner played ${ctx.userRole}.
Goal: ${ctx.goal}
Learner's level: ${level}
Target words the learner wanted to practise: ${targetWords}

Transcript:
${lines}

Assess ONLY the learner's English. Reply with ONLY a JSON object (no markdown, no prose) of exactly this shape:
{
  "summary": "<2-4 encouraging sentences on how it went>",
  "top_mistakes": [{ "user_said": "<their phrase>", "better": "<a better phrasing>", "why": "<short reason>" }],
  "target_words_used": ["<target words the learner actually used>"],
  "target_words_missed": ["<target words never used>"],
  "estimated_level": "<one of A1, A2, B1, B2, C1, C2, or null>",
  "what_to_practice_next": ["<2-4 concrete next steps>"]
}`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/**
 * Parse the report from model text. Tolerates fences/prose, reads snake_case
 * keys, coerces an invalid/missing level to null. Throws only when `summary` is
 * missing so the caller can mark the report failed and allow a retry.
 */
export function parseSessionReport(raw: string): SessionReport {
  const obj = parseJsonObject(raw);
  const summary = requireString(obj.summary, 'summary');

  const cefrRaw =
    typeof obj.estimated_level === 'string'
      ? obj.estimated_level.trim().toUpperCase()
      : '';
  const estimatedLevel = VALID_CEFR.has(cefrRaw)
    ? (cefrRaw as ProficiencyLevel)
    : null;

  return {
    summary,
    topMistakes: parseCorrections(obj.top_mistakes),
    targetWordsUsed: stringArray(obj.target_words_used, 50),
    targetWordsMissed: stringArray(obj.target_words_missed, 50),
    estimatedLevel,
    whatToPracticeNext: stringArray(obj.what_to_practice_next, 10),
  };
}

/**
 * Generate the report. Resolves to the report + the model name. Throws on
 * network error, non-2xx, timeout, or an unparseable report.
 */
export async function generateSessionReport(
  ctx: ReportContext,
  transcript: ReportTurn[],
  opts: GroqRequestOptions,
): Promise<{ report: SessionReport; model: string }> {
  const text = await chatCompletion(opts, {
    messages: buildReportMessages(ctx, transcript),
    temperature: 0.4,
    maxTokens: 1024,
    jsonMode: true,
  });
  return { report: parseSessionReport(text), model: opts.model };
}

function parseCorrections(value: unknown): Correction[] {
  if (!Array.isArray(value)) return [];
  const out: Correction[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue;
    const c = item as Record<string, unknown>;
    const userSaid = optionalString(c.user_said);
    const better = optionalString(c.better);
    if (!userSaid || !better) continue;
    out.push({ userSaid, better, why: optionalString(c.why) });
    if (out.length >= 20) break;
  }
  return out;
}
