import { ArrayMaxSize, IsArray, IsOptional, IsUUID } from 'class-validator';

// Inputs to start a live practice session: which published scenario to run and,
// optionally, which of the learner's words to weave in as soft goals. The CEFR
// level is read from the user's profile server-side, not sent here.
export class StartSessionDto {
  @IsUUID('4')
  scenarioId!: string;

  // Words the learner ticked to practise. Validated/snapshotted server-side;
  // inaccessible IDs (another user's private word, an unapproved draft) are
  // dropped and reported back. Omit or send [] to practise without target words.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  vocabularyIds?: string[];
}
