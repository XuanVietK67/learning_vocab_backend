import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { Repository } from 'typeorm';
import { CreateTopicDto } from '@/topics/dto/create-topic.dto';
import { TopicResponseDto } from '@/topics/dto/topic-response.dto';
import { UpdateTopicDto } from '@/topics/dto/update-topic.dto';
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

  async create(dto: CreateTopicDto): Promise<TopicResponseDto> {
    const existing = await this.topicRepo.findOne({
      where: { slug: dto.slug },
    });
    if (existing) {
      throw new ConflictException(`topic slug "${dto.slug}" already exists`);
    }
    const topic = this.topicRepo.create({
      slug: dto.slug,
      name: dto.name,
      description: dto.description ?? null,
      iconUrl: dto.iconUrl ?? null,
    });
    const saved = await this.topicRepo.save(topic);
    return plainToInstance(TopicResponseDto, saved, {
      excludeExtraneousValues: true,
    });
  }

  async updateBySlug(
    slug: string,
    dto: UpdateTopicDto,
  ): Promise<TopicResponseDto> {
    const topic = await this.topicRepo.findOne({ where: { slug } });
    if (!topic) {
      throw new NotFoundException('topic not found');
    }
    Object.assign(topic, dto);
    const saved = await this.topicRepo.save(topic);
    return plainToInstance(TopicResponseDto, saved, {
      excludeExtraneousValues: true,
    });
  }

  async deleteBySlug(slug: string): Promise<void> {
    const result = await this.topicRepo.delete({ slug });
    if (result.affected === 0) {
      throw new NotFoundException('topic not found');
    }
  }
}
