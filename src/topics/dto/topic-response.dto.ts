import { Expose } from 'class-transformer';

export class TopicResponseDto {
  @Expose() id!: string;
  @Expose() slug!: string;
  @Expose() name!: string;
  @Expose() description!: string | null;
  @Expose() iconUrl!: string | null;
}
