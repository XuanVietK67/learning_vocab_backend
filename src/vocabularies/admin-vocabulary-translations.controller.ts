import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Roles } from '@/auth/decorators/roles.decorator';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/auth/guards/roles.guard';
import { UserRole } from '@/users/entities/user.entity';
import {
  CreateAdminTranslationDto,
  UpdateAdminTranslationDto,
} from '@/vocabularies/dto/admin-translation.dto';
import { VocabularyTranslationResponseDto } from '@/vocabularies/dto/vocabulary-response.dto';
import { VocabulariesService } from '@/vocabularies/vocabularies.service';

const uuid = () => new ParseUUIDPipe({ version: '4' });

@Controller({
  path: 'admin/vocabularies/:vocabId/senses/:senseId/translations',
  version: '1',
})
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminVocabularyTranslationsController {
  constructor(private readonly vocabulariesService: VocabulariesService) {}

  @Post()
  add(
    @Param('vocabId', uuid()) vocabId: string,
    @Param('senseId', uuid()) senseId: string,
    @Body() dto: CreateAdminTranslationDto,
  ): Promise<VocabularyTranslationResponseDto> {
    return this.vocabulariesService.addTranslation(vocabId, senseId, dto);
  }

  @Patch(':translationId')
  update(
    @Param('vocabId', uuid()) vocabId: string,
    @Param('senseId', uuid()) senseId: string,
    @Param('translationId', uuid()) translationId: string,
    @Body() dto: UpdateAdminTranslationDto,
  ): Promise<VocabularyTranslationResponseDto> {
    return this.vocabulariesService.updateTranslation(
      vocabId,
      senseId,
      translationId,
      dto,
    );
  }

  @Delete(':translationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('vocabId', uuid()) vocabId: string,
    @Param('senseId', uuid()) senseId: string,
    @Param('translationId', uuid()) translationId: string,
  ): Promise<void> {
    return this.vocabulariesService.deleteTranslation(
      vocabId,
      senseId,
      translationId,
    );
  }
}
