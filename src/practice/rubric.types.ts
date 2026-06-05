import { ProficiencyLevel } from '@/users/entities/proficiency-level.enum';

/**
 * Structured judgment the Gemma judge returns for one sentence attempt. Stored
 * verbatim in `production_attempts.rubric` (jsonb).
 *
 * `overall` (0–100) and `cefr` measure DIFFERENT axes and must not be derived
 * from each other: `overall` is how good the attempt is (correctness, grammar,
 * used the word right); `cefr` is the linguistic level the sentence
 * *demonstrates*. A perfectly correct simple sentence is high `overall` / low
 * `cefr`. `cefr` is the level of THIS sentence, never the user's certified level.
 */
export interface ProductionRubric {
  overall: number; // 0–100, roll-up of `criteria`
  usesTargetWord: boolean; // target lemma (or an inflection) present
  correctUsage: boolean; // used with a sense that fits
  criteria: {
    grammar: number; // 0–5
    wordUsage: number; // 0–5
    naturalness: number; // 0–5
    relevance: number; // 0–5
  };
  cefr: ProficiencyLevel; // demonstrated level of this sentence (A1–C2)
  feedback: string; // 1–2 sentences for the learner
  correctedSentence?: string; // optional improved version
}
