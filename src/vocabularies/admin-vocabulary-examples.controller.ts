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
  CreateAdminExampleDto,
  UpdateAdminExampleDto,
} from '@/vocabularies/dto/admin-example.dto';
import { VocabularyExampleResponseDto } from '@/vocabularies/dto/vocabulary-response.dto';
import { VocabulariesService } from '@/vocabularies/vocabularies.service';

const uuid = () => new ParseUUIDPipe({ version: '4' });

@Controller({
  path: 'admin/vocabularies/:vocabId/senses/:senseId/examples',
  version: '1',
})
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminVocabularyExamplesController {
  constructor(private readonly vocabulariesService: VocabulariesService) {}

  @Post()
  add(
    @Param('vocabId', uuid()) vocabId: string,
    @Param('senseId', uuid()) senseId: string,
    @Body() dto: CreateAdminExampleDto,
  ): Promise<VocabularyExampleResponseDto> {
    return this.vocabulariesService.addExample(vocabId, senseId, dto);
  }

  @Patch(':exampleId')
  update(
    @Param('vocabId', uuid()) vocabId: string,
    @Param('senseId', uuid()) senseId: string,
    @Param('exampleId', uuid()) exampleId: string,
    @Body() dto: UpdateAdminExampleDto,
  ): Promise<VocabularyExampleResponseDto> {
    return this.vocabulariesService.updateExample(
      vocabId,
      senseId,
      exampleId,
      dto,
    );
  }

  @Delete(':exampleId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('vocabId', uuid()) vocabId: string,
    @Param('senseId', uuid()) senseId: string,
    @Param('exampleId', uuid()) exampleId: string,
  ): Promise<void> {
    return this.vocabulariesService.deleteExample(vocabId, senseId, exampleId);
  }
}
