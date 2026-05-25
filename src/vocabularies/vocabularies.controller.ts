import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  VocabularyDetailQueryDto,
  VocabularyQueryDto,
} from '@/vocabularies/dto/vocabulary-query.dto';
import {
  PaginatedVocabulariesResponseDto,
  VocabularyResponseDto,
} from '@/vocabularies/dto/vocabulary-response.dto';
import { VocabulariesService } from '@/vocabularies/vocabularies.service';

@Controller({ path: 'vocabularies', version: '1' })
export class VocabulariesController {
  constructor(private readonly vocabulariesService: VocabulariesService) {}

  @Get()
  findAll(
    @Query() query: VocabularyQueryDto,
  ): Promise<PaginatedVocabulariesResponseDto> {
    return this.vocabulariesService.findAll(query);
  }

  @Get(':id')
  findOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query() query: VocabularyDetailQueryDto,
  ): Promise<VocabularyResponseDto> {
    return this.vocabulariesService.findById(id, query.translationLang);
  }
}
