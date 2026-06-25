import { Expose, Type } from 'class-transformer';
import { ProficiencyLevel } from '@/users/entities/proficiency-level.enum';
import { SpeakingReportStatus } from '@/speaking-room/entities/speaking-report-status.enum';
import { SpeakingSessionStatus } from '@/speaking-room/entities/speaking-session-status.enum';

// One on-screen correction (shown as text, never spoken).
export class CorrectionDto {
  @Expose() userSaid!: string;
  @Expose() better!: string;
  @Expose() why!: string;
}

// Returned when a session is started: the session handle plus the AI's opening
// line (turn 0), which the client speaks/shows first.
export class SessionStartedDto {
  @Expose() id!: string;
  @Expose() scenarioId!: string;
  @Expose() status!: SpeakingSessionStatus;
  @Expose() cefrLevel!: ProficiencyLevel | null;
  @Expose() selectedWords!: string[];
  // IDs that were requested but not usable (dropped from the session).
  @Expose() inaccessibleVocabularyIds!: string[];
  @Expose() openingLine!: string;
  @Expose() createdAt!: Date;
}

// Returned after each user turn: the AI reply (to speak) + the corrections (to
// show) + which target words the AI used.
export class TurnResultDto {
  @Expose() turnIndex!: number;
  @Expose() reply!: string;

  @Expose()
  @Type(() => CorrectionDto)
  corrections!: CorrectionDto[];

  @Expose() usedTargetWords!: string[];
}

// The body of the end-of-session feedback report.
export class SessionReportDto {
  @Expose() summary!: string;

  @Expose()
  @Type(() => CorrectionDto)
  topMistakes!: CorrectionDto[];

  @Expose() targetWordsUsed!: string[];
  @Expose() targetWordsMissed!: string[];
  @Expose() estimatedLevel!: ProficiencyLevel | null;
  @Expose() whatToPracticeNext!: string[];
}

// Wraps the report with its generation status: `report` is null until ready,
// `failed` if the LLM call/parse failed (the client may retry via GET).
export class SessionReportResponseDto {
  @Expose() sessionId!: string;
  @Expose() reportStatus!: SpeakingReportStatus;

  @Expose()
  @Type(() => SessionReportDto)
  report!: SessionReportDto | null;

  @Expose() reportModel!: string | null;
}
