import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Roles } from '@/auth/decorators/roles.decorator';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/auth/guards/roles.guard';
import { UserRole } from '@/users/entities/user.entity';
import { AdminVocabularyQueryDto } from '@/vocabularies/dto/admin-vocabulary-query.dto';
import { PaginatedAdminVocabulariesResponseDto } from '@/vocabularies/dto/admin-vocabulary-response.dto';
import {
  BulkImportSummaryDto,
  BulkImportVocabulariesDto,
} from '@/vocabularies/dto/bulk-import-vocabularies.dto';
import { CreateVocabularyDto } from '@/vocabularies/dto/create-vocabulary.dto';
import { UpdateVocabularyDto } from '@/vocabularies/dto/update-vocabulary.dto';
import { VocabularyResponseDto } from '@/vocabularies/dto/vocabulary-response.dto';
import { VocabulariesService } from '@/vocabularies/vocabularies.service';

@Controller({ path: 'admin/vocabularies', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminVocabulariesController {
  constructor(private readonly vocabulariesService: VocabulariesService) {}

  @Get()
  findAll(
    @Query() query: AdminVocabularyQueryDto,
  ): Promise<PaginatedAdminVocabulariesResponseDto> {
    return this.vocabulariesService.findAllForAdmin(query);
  }

  @Post()
  create(@Body() dto: CreateVocabularyDto): Promise<VocabularyResponseDto> {
    return this.vocabulariesService.createSystemVocabulary(dto);
  }

  @Post('bulk-import')
  @HttpCode(HttpStatus.OK)
  bulkImport(
    @Body() dto: BulkImportVocabulariesDto,
  ): Promise<BulkImportSummaryDto> {
    return this.vocabulariesService.bulkImportSystemVocabularies(dto);
  }

  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateVocabularyDto,
  ): Promise<VocabularyResponseDto> {
    return this.vocabulariesService.updateSystemVocabulary(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<void> {
    return this.vocabulariesService.deleteSystemVocabulary(id);
  }
}
