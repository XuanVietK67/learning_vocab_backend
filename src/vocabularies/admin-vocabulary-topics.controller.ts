import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Put,
  UseGuards,
} from '@nestjs/common';
import { Roles } from '@/auth/decorators/roles.decorator';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/auth/guards/roles.guard';
import { TopicResponseDto } from '@/topics/dto/topic-response.dto';
import { UserRole } from '@/users/entities/user.entity';
import { AdminTopicsReplaceDto } from '@/vocabularies/dto/admin-topics-replace.dto';
import { VocabulariesService } from '@/vocabularies/vocabularies.service';

@Controller({ path: 'admin/vocabularies/:vocabId/topics', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminVocabularyTopicsController {
  constructor(private readonly vocabulariesService: VocabulariesService) {}

  @Put()
  replace(
    @Param('vocabId', new ParseUUIDPipe({ version: '4' })) vocabId: string,
    @Body() dto: AdminTopicsReplaceDto,
  ): Promise<TopicResponseDto[]> {
    return this.vocabulariesService.replaceTopics(vocabId, dto);
  }
}
