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
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import { Roles } from '@/auth/decorators/roles.decorator';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/auth/guards/roles.guard';
import type { AuthenticatedUser } from '@/auth/strategies/jwt.strategy';
import { UserRole } from '@/users/entities/user.entity';
import { AdminVocabularyQueryDto } from '@/vocabularies/dto/admin-vocabulary-query.dto';
import { PaginatedAdminVocabulariesResponseDto } from '@/vocabularies/dto/admin-vocabulary-response.dto';
import {
  BulkImportSummaryDto,
  BulkImportVocabulariesDto,
} from '@/vocabularies/dto/bulk-import-vocabularies.dto';
import { CreateVocabularyDto } from '@/vocabularies/dto/create-vocabulary.dto';
import { EnrichmentJobResponseDto } from '@/vocabularies/dto/enrichment-job-response.dto';
import { QuickCreateVocabularyDto } from '@/vocabularies/dto/quick-create-vocabulary.dto';
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

  // Quick-create: submit only a lemma; a worker enriches it into draft
  // vocabularies. Returns 202 + the job to poll.
  @Post('quick')
  @HttpCode(HttpStatus.ACCEPTED)
  quickCreate(
    @CurrentUser() current: AuthenticatedUser,
    @Body() dto: QuickCreateVocabularyDto,
  ): Promise<EnrichmentJobResponseDto> {
    return this.vocabulariesService.quickCreateVocabulary(dto, current.id);
  }

  @Get('quick/:jobId')
  getEnrichmentJob(
    @Param('jobId', new ParseUUIDPipe({ version: '4' })) jobId: string,
  ): Promise<EnrichmentJobResponseDto> {
    return this.vocabulariesService.getEnrichmentJob(jobId);
  }

  // Publish a draft: flip is_approved and trigger audio + image generation.
  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  approve(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<VocabularyResponseDto> {
    return this.vocabulariesService.approveVocabulary(id);
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
