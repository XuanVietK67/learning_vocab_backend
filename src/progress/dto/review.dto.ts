import { IsInt, IsUUID, Max, Min } from 'class-validator';

export class ReviewDto {
  @IsUUID('4')
  vocabularyId!: string;

  // SM-2 quality. 0-2 = forgot, 3-5 = remembered.
  @IsInt()
  @Min(0)
  @Max(5)
  quality!: number;
}
