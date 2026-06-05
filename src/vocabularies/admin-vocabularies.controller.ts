import {
  BadRequestException,
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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
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
import {
  BulkQuickCreateDto,
  BulkQuickCreateResponseDto,
} from '@/vocabularies/dto/bulk-quick-create.dto';
import { CreateVocabularyDto } from '@/vocabularies/dto/create-vocabulary.dto';
import { EnrichmentBatchResponseDto } from '@/vocabularies/dto/enrichment-batch-response.dto';
import { EnrichmentJobResponseDto } from '@/vocabularies/dto/enrichment-job-response.dto';
import {
  ExtractLemmasDto,
  ExtractLemmasResponseDto,
} from '@/vocabularies/dto/extract-lemmas.dto';
import { QuickCreateVocabularyDto } from '@/vocabularies/dto/quick-create-vocabulary.dto';
import { UpdateVocabularyDto } from '@/vocabularies/dto/update-vocabulary.dto';
import { VocabularyResponseDto } from '@/vocabularies/dto/vocabulary-response.dto';
import { SourceKind } from '@/vocabularies/enrichment/import/lemma-extractor';
import { VocabulariesService } from '@/vocabularies/vocabularies.service';

const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;

// Map an uploaded file to a parser kind by extension/mimetype. Throws 400 for
// anything we don't support.
function resolveSourceKind(file: Express.Multer.File): SourceKind {
  const name = file.originalname.toLowerCase();
  const mime = file.mimetype;
  if (name.endsWith('.pdf') || mime === 'application/pdf') return 'pdf';
  if (
    name.endsWith('.xlsx') ||
    mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ) {
    return 'xlsx';
  }
  if (name.endsWith('.csv') || mime === 'text/csv') return 'csv';
  if (name.endsWith('.txt') || mime === 'text/plain') return 'text';
  throw new BadRequestException(
    'unsupported file type — use .txt, .csv, .xlsx, or .pdf',
  );
}

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

  // Phase 1 of bulk quick-create: parse an uploaded file (.txt/.csv/.xlsx/.pdf)
  // or pasted `text` into candidate lemmas for the admin to review. Stateless —
  // no jobs are created here.
  @Post('quick/extract')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_FILE_BYTES } }),
  )
  extractLemmas(
    @Body() dto: ExtractLemmasDto,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<ExtractLemmasResponseDto> {
    const mode = dto.mode ?? 'list';
    const language = dto.language ?? 'en';

    if (file) {
      const kind = resolveSourceKind(file);
      if (kind === 'text') {
        return this.vocabulariesService.extractLemmas({
          kind,
          mode,
          language,
          text: file.buffer.toString('utf8'),
        });
      }
      return this.vocabulariesService.extractLemmas({
        kind,
        mode,
        language,
        buffer: file.buffer,
      });
    }

    if (dto.text && dto.text.trim()) {
      return this.vocabulariesService.extractLemmas({
        kind: 'text',
        mode,
        language,
        text: dto.text,
      });
    }

    throw new BadRequestException('provide a file or non-empty text');
  }

  // Phase 2: enrich a confirmed list of lemmas. One job per lemma under a shared
  // batchId. Returns 202 + { batchId, accepted, skipped }.
  @Post('quick/bulk')
  @HttpCode(HttpStatus.ACCEPTED)
  bulkQuickCreate(
    @CurrentUser() current: AuthenticatedUser,
    @Body() dto: BulkQuickCreateDto,
  ): Promise<BulkQuickCreateResponseDto> {
    return this.vocabulariesService.bulkQuickCreateVocabulary(dto, current.id);
  }

  @Get('quick/:jobId')
  getEnrichmentJob(
    @Param('jobId', new ParseUUIDPipe({ version: '4' })) jobId: string,
  ): Promise<EnrichmentJobResponseDto> {
    return this.vocabulariesService.getEnrichmentJob(jobId);
  }

  @Get('quick/batch/:batchId')
  getEnrichmentBatch(
    @Param('batchId', new ParseUUIDPipe({ version: '4' })) batchId: string,
  ): Promise<EnrichmentBatchResponseDto> {
    return this.vocabulariesService.getEnrichmentBatch(batchId);
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
