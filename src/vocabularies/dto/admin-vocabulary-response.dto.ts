import { Expose, Type } from 'class-transformer';
import { VocabularyResponseDto } from '@/vocabularies/dto/vocabulary-response.dto';
import { Visibility } from '@/vocabularies/entities/visibility.enum';

export class AdminVocabularyResponseDto extends VocabularyResponseDto {
  // Representative thumbnail for list/table views: the imageUrl of the
  // lowest-ordered sense that has one, or null when no sense has an image.
  // The full per-sense images remain available under `senses[].imageUrl`.
  @Expose() imageUrl!: string | null;
  @Expose() visibility!: Visibility;
  @Expose() isApproved!: boolean;
  @Expose() createdByUserId!: string | null;
  @Expose() enrichedAt!: Date | null;
  @Expose() createdAt!: Date;
  @Expose() updatedAt!: Date;
}

export class PaginatedAdminVocabulariesResponseDto {
  @Expose()
  @Type(() => AdminVocabularyResponseDto)
  data!: AdminVocabularyResponseDto[];

  @Expose() page!: number;
  @Expose() limit!: number;
  @Expose() total!: number;
}
