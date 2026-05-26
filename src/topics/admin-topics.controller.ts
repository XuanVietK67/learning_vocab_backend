import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Roles } from '@/auth/decorators/roles.decorator';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/auth/guards/roles.guard';
import { CreateTopicDto } from '@/topics/dto/create-topic.dto';
import { TopicResponseDto } from '@/topics/dto/topic-response.dto';
import { UpdateTopicDto } from '@/topics/dto/update-topic.dto';
import { TopicsService } from '@/topics/topics.service';
import { UserRole } from '@/users/entities/user.entity';

@Controller({ path: 'admin/topics', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminTopicsController {
  constructor(private readonly topicsService: TopicsService) {}

  @Post()
  create(@Body() dto: CreateTopicDto): Promise<TopicResponseDto> {
    return this.topicsService.create(dto);
  }

  @Patch(':slug')
  update(
    @Param('slug') slug: string,
    @Body() dto: UpdateTopicDto,
  ): Promise<TopicResponseDto> {
    return this.topicsService.updateBySlug(slug, dto);
  }

  @Delete(':slug')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('slug') slug: string): Promise<void> {
    return this.topicsService.deleteBySlug(slug);
  }
}
