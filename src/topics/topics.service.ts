import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { Repository } from 'typeorm';
import { TopicResponseDto } from '@/topics/dto/topic-response.dto';
import { Topic } from '@/topics/entities/topic.entity';

@Injectable()
export class TopicsService {
  constructor(
    @InjectRepository(Topic)
    private readonly topicRepo: Repository<Topic>,
  ) {}

  async findAll(): Promise<TopicResponseDto[]> {
    const topics = await this.topicRepo.find({ order: { name: 'ASC' } });
    return topics.map((t) =>
      plainToInstance(TopicResponseDto, t, { excludeExtraneousValues: true }),
    );
  }

  async findBySlug(slug: string): Promise<TopicResponseDto> {
    const topic = await this.topicRepo.findOne({ where: { slug } });
    if (!topic) {
      throw new NotFoundException('topic not found');
    }
    return plainToInstance(TopicResponseDto, topic, {
      excludeExtraneousValues: true,
    });
  }
}
