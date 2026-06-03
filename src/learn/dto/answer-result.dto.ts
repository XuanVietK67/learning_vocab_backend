import { ProgressResponseDto } from '@/progress/dto/progress-response.dto';
import { SessionItemDto } from '@/learn/dto/session-item.dto';

// Intra-session requeue: when the SRS schedules the card within the
// configured requeue window (default 15 min), the server bakes the word's
// next lesson ladder (for its now-advanced stage) and the client surfaces it
// again at `dueAtMs`. Null when the next review is far enough out that the
// next /session call will handle it.
export interface RequeuedItemDto {
  dueAtMs: number;
  items: SessionItemDto[];
}

export interface AnswerResultDto {
  correct: boolean;
  correctAnswer: string;
  quality: number; // 0–5 (SM-2)
  // The updated schedule for this card. Populated ONLY on the SRS-bearing
  // (final) step of a word's lesson — the only answer that reschedules.
  // Null on earlier steps, which grade for feedback only.
  progress: ProgressResponseDto | null;
  requeue: RequeuedItemDto | null;
}
