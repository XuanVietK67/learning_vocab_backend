import { ProgressResponseDto } from '@/progress/dto/progress-response.dto';
import { SessionItemDto } from '@/learn/dto/session-item.dto';

// Intra-session requeue: when the SRS schedules the card within the
// configured requeue window (default 15 min), the server bakes a fresh
// signed question for the same card and the client surfaces it again
// at `dueAtMs`. Null when the next review is far enough out that the
// next /session call will handle it.
export interface RequeuedItemDto {
  dueAtMs: number;
  item: SessionItemDto;
}

export interface AnswerResultDto {
  correct: boolean;
  correctAnswer: string;
  quality: number; // 0–5 (SM-2)
  progress: ProgressResponseDto;
  requeue: RequeuedItemDto | null;
}
