import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { FindOptionsWhere, Repository } from 'typeorm';
import { AttachIntroVideoDto } from '@/speaking-room/dto/attach-intro-video.dto';
import { CreateScenarioDto } from '@/speaking-room/dto/create-scenario.dto';
import {
  PaginatedScenariosResponseDto,
  ScenarioResponseDto,
} from '@/speaking-room/dto/scenario-response.dto';
import { ScenarioQueryDto } from '@/speaking-room/dto/scenario-query.dto';
import { UpdateScenarioDto } from '@/speaking-room/dto/update-scenario.dto';
import { ScenarioStatus } from '@/speaking-room/entities/scenario-status.enum';
import { Scenario } from '@/speaking-room/entities/scenario.entity';

@Injectable()
export class ScenariosService {
  constructor(
    @InjectRepository(Scenario)
    private readonly scenarioRepo: Repository<Scenario>,
  ) {}

  async findAll(
    query: ScenarioQueryDto,
  ): Promise<PaginatedScenariosResponseDto> {
    const where: FindOptionsWhere<Scenario> = {};
    if (query.topic) where.topic = query.topic;
    if (query.cefrLevel) where.cefrLevel = query.cefrLevel;
    if (query.status) where.status = query.status;

    const [rows, total] = await this.scenarioRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });

    return plainToInstance(
      PaginatedScenariosResponseDto,
      {
        data: rows,
        page: query.page,
        limit: query.limit,
        total,
      },
      { excludeExtraneousValues: true },
    );
  }

  async findOne(id: string): Promise<ScenarioResponseDto> {
    const scenario = await this.getOrThrow(id);
    return this.toDto(scenario);
  }

  async create(
    dto: CreateScenarioDto,
    createdBy: string,
  ): Promise<ScenarioResponseDto> {
    const scenario = this.scenarioRepo.create({
      title: dto.title,
      topic: dto.topic,
      cefrLevel: dto.cefrLevel ?? null,
      setting: dto.setting,
      aiRole: dto.aiRole,
      userRole: dto.userRole,
      goal: dto.goal,
      openingLine: dto.openingLine,
      seedPhrases: dto.seedPhrases ?? [],
      estTurns: dto.estTurns ?? null,
      introVideoScript: dto.introVideoScript ?? null,
      status: ScenarioStatus.DRAFT,
      createdBy,
    });
    const saved = await this.scenarioRepo.save(scenario);
    return this.toDto(saved);
  }

  async update(
    id: string,
    dto: UpdateScenarioDto,
  ): Promise<ScenarioResponseDto> {
    const scenario = await this.getOrThrow(id);
    Object.assign(scenario, dto);
    return this.saveBumpingVersion(scenario);
  }

  // Attaches the finished intro-video URL (and optionally its script). Phase 1
  // does not run the render itself — see AttachIntroVideoDto.
  async attachIntroVideo(
    id: string,
    dto: AttachIntroVideoDto,
  ): Promise<ScenarioResponseDto> {
    const scenario = await this.getOrThrow(id);
    scenario.introVideoUrl = dto.introVideoUrl;
    if (dto.introVideoScript !== undefined) {
      scenario.introVideoScript = dto.introVideoScript;
    }
    return this.saveBumpingVersion(scenario);
  }

  async publish(id: string): Promise<ScenarioResponseDto> {
    const scenario = await this.getOrThrow(id);
    if (scenario.status === ScenarioStatus.PUBLISHED) {
      throw new BadRequestException('scenario is already published');
    }
    scenario.status = ScenarioStatus.PUBLISHED;
    const saved = await this.scenarioRepo.save(scenario);
    return this.toDto(saved);
  }

  // Soft-delete: retire so existing references stay intact and the catalog can
  // hide it from new sessions. A hard DELETE would orphan Phase 2 history.
  async retire(id: string): Promise<void> {
    const scenario = await this.getOrThrow(id);
    if (scenario.status === ScenarioStatus.RETIRED) {
      return;
    }
    scenario.status = ScenarioStatus.RETIRED;
    await this.scenarioRepo.save(scenario);
  }

  private async getOrThrow(id: string): Promise<Scenario> {
    const scenario = await this.scenarioRepo.findOne({ where: { id } });
    if (!scenario) {
      throw new NotFoundException('scenario not found');
    }
    return scenario;
  }

  // Editing a published scenario bumps its version so Phase 2 in-flight sessions
  // keep the spec they started with. Drafts have no live sessions, so they are
  // edited in place.
  private async saveBumpingVersion(
    scenario: Scenario,
  ): Promise<ScenarioResponseDto> {
    if (scenario.status === ScenarioStatus.PUBLISHED) {
      scenario.version += 1;
    }
    const saved = await this.scenarioRepo.save(scenario);
    return this.toDto(saved);
  }

  private toDto(scenario: Scenario): ScenarioResponseDto {
    return plainToInstance(ScenarioResponseDto, scenario, {
      excludeExtraneousValues: true,
    });
  }
}
