/** Shared queue name + job payload contract between the API producer and the
 * worker consumer. Keep this free of NestJS imports so both sides can use it. */

export const AUDIO_QUEUE = 'vocab-audio';

export const GENERATE_AUDIO_JOB = 'generate-audio';

export interface GenerateAudioJobData {
  vocabId: string;
  lemma: string;
  language: string;
}
