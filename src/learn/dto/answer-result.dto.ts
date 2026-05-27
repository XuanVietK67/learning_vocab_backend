import { ProgressResponseDto } from '@/progress/dto/progress-response.dto';

export interface AnswerResultDto {
  correct: boolean;
  correctAnswer: string;
  quality: number; // 0–5 (SM-2)
  progress: ProgressResponseDto;
}
