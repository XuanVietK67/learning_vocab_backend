import { ProficiencyLevel } from '@/users/entities/proficiency-level.enum';

// Shared structured shapes for the Phase 2 live session. Kept framework-agnostic
// (no NestJS, no TypeORM) so the LLM cores and the entities can both import them.

// One gentle, on-screen correction. Shown as text, never spoken — so the spoken
// conversation is not interrupted to fix grammar (see plan §5).
export interface Correction {
  // What the learner actually said (verbatim or paraphrased).
  userSaid: string;
  // A more natural / correct way to say it at their level.
  better: string;
  // Short, encouraging explanation of the fix.
  why: string;
}

// The parsed result of one AI turn: the spoken reply plus the teaching side-band.
export interface TurnReply {
  // What the AI says, in character. This is the only part that would go to TTS.
  reply: string;
  // Zero or more corrections for what the learner just said.
  corrections: Correction[];
  // Which of the session's target words the AI actually wove into `reply`.
  usedTargetWords: string[];
}

// Snapshot of the textual scenario fields the live prompt needs, frozen onto a
// session at start. Phase 1 versioning bumps the scenario row IN PLACE (it does
// not keep old versions), so snapshotting is what actually keeps an in-flight
// conversation stable when an admin edits the scenario mid-session.
export interface ScenarioSnapshot {
  title: string;
  aiRole: string;
  userRole: string;
  setting: string;
  goal: string;
  openingLine: string;
}

// The end-of-session feedback report (one slower LLM call over the transcript).
export interface SessionReport {
  // 2-4 sentence encouraging overview of how the conversation went.
  summary: string;
  // The most useful corrections to focus on, distilled from the whole session.
  topMistakes: Correction[];
  // Target words the learner successfully used during the conversation.
  targetWordsUsed: string[];
  // Target words that were set but never used — good candidates to revisit.
  targetWordsMissed: string[];
  // The level the conversation actually demonstrated (may differ from the
  // learner's certified level); null if the model couldn't estimate one.
  estimatedLevel: ProficiencyLevel | null;
  // Concrete next steps: phrases, grammar points, or words to practise.
  whatToPracticeNext: string[];
}
