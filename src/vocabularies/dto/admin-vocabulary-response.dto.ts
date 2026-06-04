import { Expose, Type } from 'class-transformer';
import { VocabularyResponseDto } from '@/vocabularies/dto/vocabulary-response.dto';
import { Visibility } from '@/vocabularies/entities/visibility.enum';

export class AdminVocabularyResponseDto extends VocabularyResponseDto {
  // Representative thumbnail for list/table views: the imageUrl of the
  // lowest-ordered sense that has one, or null when no sense has an image.
  // The full per-sense images remain available under `senses[].imageUrl`.
  @Expose() imageUrl!: string | null;
  // All distinct sense image URLs for this vocabulary, in sense_order, with
  // nulls dropped. Lets a list view render every available thumbnail without
  // walking `senses[]`. Empty array when no sense has an image.
  @Expose() images!: string[];
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
