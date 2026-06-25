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
import { Correction, TurnReply } from '@/speaking-room/speaking-room.types';
import { ProficiencyLevel } from '@/users/entities/proficiency-level.enum';

/**
 * Framework-agnostic core for one turn of the live conversation. No NestJS, no
 * DB, no DI — just the Groq call plus the prompt builder and the defensive JSON
 * parser (both exported for unit testing). Mirrors scenario-draft.ts.
 *
 * The model both stays in character (the spoken `reply`) AND tutors on the side
 * (the `corrections`), returning a single JSON object per turn so the two
 * channels never block each other (plan §5).
 */

// The fixed (per-session) half of the conversation context.
export interface ConversationContext {
  aiRole: string;
  userRole: string;
  setting: string;
  goal: string;
  // Drives how hard the AI's language is; null = no level pinned.
  cefrLevel: ProficiencyLevel | null;
  // Soft goals: words to weave in when they fit naturally. May be empty.
  selectedWords: string[];
}

// A prior utterance fed back as conversation history.
export interface HistoryTurn {
  role: 'ai' | 'user';
  text: string;
}

/** Build the chat messages for one turn: system contract + history + new user text. */
export function buildTurnMessages(
  ctx: ConversationContext,
  history: HistoryTurn[],
  userText: string,
): ChatMessage[] {
  const level = ctx.cefrLevel
    ? `${ctx.cefrLevel} (CEFR)`
    : 'an everyday conversational level';
  const targetWordsRule =
    ctx.selectedWords.length > 0
      ? `\n- Naturally use these target words when they fit, but do not force them: ${ctx.selectedWords.join(', ')}.`
      : '';

  const system = `You are ${ctx.aiRole} in this scenario: ${ctx.setting}. The user plays ${ctx.userRole}.
Goal of the conversation: ${ctx.goal}.

Rules:
- The user is an English learner whose native language is Vietnamese. Their level is ${level}. Use vocabulary and grammar at that level — never harder.
- Keep replies SHORT (1-3 sentences) and ALWAYS end with a question to keep the conversation going.
- Stay in character. Do NOT interrupt the conversation to correct grammar.
- When the user makes a meaningful English mistake, record it in "corrections" (not spoken). Minor or no mistakes -> return an empty array.${targetWordsRule}

Reply with ONLY a JSON object (no markdown, no prose) of exactly this shape:
{
  "reply": "<what you say next, in character>",
  "corrections": [{ "user_said": "<their phrase>", "better": "<a better phrasing>", "why": "<short, kind reason>" }],
  "used_target_words": ["<target words you actually used in reply>"]
}`;

  const messages: ChatMessage[] = [{ role: 'system', content: system }];
  for (const turn of history) {
    messages.push({
      role: turn.role === 'ai' ? 'assistant' : 'user',
      content: turn.text,
    });
  }
  messages.push({ role: 'user', content: userText });
  return messages;
}

/**
 * Parse one AI turn from model text into a TurnReply. Tolerates markdown fences
 * and surrounding prose; reads the prompt's snake_case keys. Throws only when
 * `reply` is missing so the caller can surface a clear error and retry.
 */
export function parseTurnReply(raw: string): TurnReply {
  const obj = parseJsonObject(raw);
  const reply = requireString(obj.reply, 'reply');
  return {
    reply,
    corrections: parseCorrections(obj.corrections),
    usedTargetWords: stringArray(obj.used_target_words, 20),
  };
}

/**
 * Run one conversation turn. Resolves to the reply + the model name. Throws on
 * network error, non-2xx, timeout, or an unparseable reply. Key rotation lives
 * in common/groq/groq-request.ts.
 */
export async function takeConversationTurn(
  ctx: ConversationContext,
  history: HistoryTurn[],
  userText: string,
  opts: GroqRequestOptions,
): Promise<{ turn: TurnReply; model: string }> {
  const text = await chatCompletion(opts, {
    messages: buildTurnMessages(ctx, history, userText),
    temperature: 0.7,
    maxTokens: 512,
    jsonMode: true,
  });
  return { turn: parseTurnReply(text), model: opts.model };
}

// Map the model's loosely-typed corrections array into typed Corrections,
// dropping entries that lack the two essential fields.
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
