import { Controller, Get, Param } from '@nestjs/common';
import { TopicResponseDto } from '@/topics/dto/topic-response.dto';
import { TopicsService } from '@/topics/topics.service';

@Controller({ path: 'topics', version: '1' })
export class TopicsController {
  constructor(private readonly topicsService: TopicsService) {}

  @Get()
  findAll(): Promise<TopicResponseDto[]> {
    return this.topicsService.findAll();
  }

  @Get(':slug')
  findOne(@Param('slug') slug: string): Promise<TopicResponseDto> {
    return this.topicsService.findBySlug(slug);
  }
}
