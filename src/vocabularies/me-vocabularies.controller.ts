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
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '@/auth/strategies/jwt.strategy';
import { CreateVocabularyDto } from '@/vocabularies/dto/create-vocabulary.dto';
import { EnrichmentJobResponseDto } from '@/vocabularies/dto/enrichment-job-response.dto';
import { QuickCreateVocabularyDto } from '@/vocabularies/dto/quick-create-vocabulary.dto';
import { UpdateVocabularyDto } from '@/vocabularies/dto/update-vocabulary.dto';
import { UserVocabularyQueryDto } from '@/vocabularies/dto/user-vocabulary-query.dto';
import { VocabularyDetailQueryDto } from '@/vocabularies/dto/vocabulary-query.dto';
import {
  PaginatedVocabulariesResponseDto,
  VocabularyResponseDto,
} from '@/vocabularies/dto/vocabulary-response.dto';
import { VocabulariesService } from '@/vocabularies/vocabularies.service';

@Controller({ path: 'me/vocabularies', version: '1' })
@UseGuards(JwtAuthGuard)
export class MeVocabulariesController {
  constructor(private readonly vocabulariesService: VocabulariesService) {}

  @Post()
  create(
    @CurrentUser() current: AuthenticatedUser,
    @Body() dto: CreateVocabularyDto,
  ): Promise<VocabularyResponseDto> {
    return this.vocabulariesService.createUserVocabulary(current.id, dto);
  }

  // Quick-create: supply just a lemma; a worker enriches it into the caller's
  // own (private, auto-approved) word. Returns 202 + the job to poll.
  @Post('quick-create')
  @HttpCode(HttpStatus.ACCEPTED)
  quickCreate(
    @CurrentUser() current: AuthenticatedUser,
    @Body() dto: QuickCreateVocabularyDto,
  ): Promise<EnrichmentJobResponseDto> {
    return this.vocabulariesService.quickCreateUserVocabulary(current.id, dto);
  }

  // Poll the status of one of the caller's own quick-create jobs.
  @Get('jobs/:jobId')
  getJob(
    @CurrentUser() current: AuthenticatedUser,
    @Param('jobId', new ParseUUIDPipe({ version: '4' })) jobId: string,
  ): Promise<EnrichmentJobResponseDto> {
    return this.vocabulariesService.getUserEnrichmentJob(current.id, jobId);
  }

  @Get()
  findAll(
    @CurrentUser() current: AuthenticatedUser,
    @Query() query: UserVocabularyQueryDto,
  ): Promise<PaginatedVocabulariesResponseDto> {
    return this.vocabulariesService.findMyVocabularies(current.id, query);
  }

  @Get(':id')
  findOne(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query() query: VocabularyDetailQueryDto,
  ): Promise<VocabularyResponseDto> {
    return this.vocabulariesService.findMyVocabularyById(
      current.id,
      id,
      query.translationLang,
    );
  }

  @Patch(':id')
  update(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateVocabularyDto,
  ): Promise<VocabularyResponseDto> {
    return this.vocabulariesService.updateUserVocabulary(current.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<void> {
    return this.vocabulariesService.deleteUserVocabulary(current.id, id);
  }
}
