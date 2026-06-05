/** Shared queue name + job payload contract between the API producer and the
 * practice-scoring worker. Keep this free of NestJS imports so both sides can
 * use it. The job carries only the attempt id; the worker reloads the row so
 * the DB stays the single source of truth (mirrors the audio queue). */

export const PRACTICE_SCORING_QUEUE = 'practice-scoring';

export const SCORE_SENTENCE_JOB = 'score-sentence';

export interface ScoreSentenceJobData {
  attemptId: string;
}
