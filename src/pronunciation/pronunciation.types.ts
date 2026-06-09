// The wire contract returned by the Python scoring service (POST /score).
// Field names are kept verbatim (snake_case) so the per-phone payload can be
// stored and re-exposed without a lossy transform.

export type PhonemeLabel = 'good' | 'practice' | 'wrong';

export interface PhonemeScore {
  phone: string;
  score: number;
  label: PhonemeLabel;
  start_sec: number;
  end_sec: number;
}

export interface AudioQuality {
  duration_sec: number;
  too_short: boolean;
  clipping: boolean;
  snr_db: number;
}

export interface ScoreServiceResponse {
  word: string;
  transcript_phonemes: string[];
  overall_score: number;
  phonemes: PhonemeScore[];
  audio_quality: AudioQuality;
  model_version: string;
}
