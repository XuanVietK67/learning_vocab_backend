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
  Put,
  UseGuards,
} from '@nestjs/common';
import { Roles } from '@/auth/decorators/roles.decorator';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/auth/guards/roles.guard';
import { UserRole } from '@/users/entities/user.entity';
import { AdminSenseReorderDto } from '@/vocabularies/dto/admin-sense-reorder.dto';
import {
  CreateAdminSenseDto,
  UpdateAdminSenseDto,
} from '@/vocabularies/dto/admin-sense.dto';
import { VocabularySenseResponseDto } from '@/vocabularies/dto/vocabulary-response.dto';
import { VocabulariesService } from '@/vocabularies/vocabularies.service';

const uuid = () => new ParseUUIDPipe({ version: '4' });

@Controller({ path: 'admin/vocabularies/:vocabId/senses', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminVocabularySensesController {
  constructor(private readonly vocabulariesService: VocabulariesService) {}

  @Post()
  add(
    @Param('vocabId', uuid()) vocabId: string,
    @Body() dto: CreateAdminSenseDto,
  ): Promise<VocabularySenseResponseDto> {
    return this.vocabulariesService.addSense(vocabId, dto);
  }

  @Put('reorder')
  reorder(
    @Param('vocabId', uuid()) vocabId: string,
    @Body() dto: AdminSenseReorderDto,
  ): Promise<VocabularySenseResponseDto[]> {
    return this.vocabulariesService.reorderSenses(vocabId, dto);
  }

  @Patch(':senseId')
  update(
    @Param('vocabId', uuid()) vocabId: string,
    @Param('senseId', uuid()) senseId: string,
    @Body() dto: UpdateAdminSenseDto,
  ): Promise<VocabularySenseResponseDto> {
    return this.vocabulariesService.updateSense(vocabId, senseId, dto);
  }

  @Delete(':senseId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('vocabId', uuid()) vocabId: string,
    @Param('senseId', uuid()) senseId: string,
  ): Promise<void> {
    return this.vocabulariesService.deleteSense(vocabId, senseId);
  }
}
