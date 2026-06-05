/** Shared queue name + job payload contract between the API producer and the
 * image worker consumer. Keep this free of NestJS imports so both sides can
 * use it. */

export const IMAGE_QUEUE = 'vocab-image';

export const GENERATE_IMAGE_JOB = 'generate-image';

export interface GenerateImageJobData {
  senseId: string;
  lemma: string;
  language: string;
}
