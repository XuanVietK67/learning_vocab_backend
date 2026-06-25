import { IsString, Length } from 'class-validator';

// One learner utterance in the turn loop. In Phase 2a this is typed text; the
// audio/STT variant (Phase 2c) will transcribe to the same field server-side.
export class TakeTurnDto {
  @IsString()
  @Length(1, 1000)
  text!: string;
}
