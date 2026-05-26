import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateTopicDto } from '@/topics/dto/create-topic.dto';

// Slug is the identifier — not editable. To rename a slug, DELETE then POST.
export class UpdateTopicDto extends PartialType(
  OmitType(CreateTopicDto, ['slug'] as const),
) {}
