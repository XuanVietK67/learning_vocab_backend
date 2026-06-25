import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { GroqRequestOptions } from '@/common/groq/groq-request';
import { DraftScenarioDto } from '@/speaking-room/dto/draft-scenario.dto';
import { ScenarioDraftResponseDto } from '@/speaking-room/dto/scenario-draft-response.dto';
import { draftScenario } from '@/speaking-room/scenario-draft';

// Admin-only LLM draft helper for scenario authoring. Calls Groq synchronously
// (the admin is waiting on the response), unlike the practice judge which runs
// through a BullMQ queue. Maps Groq/parse failures to a 503 so the admin can
// retry or fall back to writing the spec by hand.
@Injectable()
export class ScenarioDraftService {
  private readonly logger = new Logger(ScenarioDraftService.name);

  constructor(private readonly config: ConfigService) {}

  async draft(dto: DraftScenarioDto): Promise<ScenarioDraftResponseDto> {
    const opts = this.groqOptions();
    if (opts.apiKeys.length === 0) {
      throw new ServiceUnavailableException(
        'scenario draft helper is not configured',
      );
    }

    try {
      const { draft, model } = await draftScenario(
        {
          brief: dto.brief,
          cefrLevel: dto.cefrLevel ?? null,
          topic: dto.topic ?? null,
        },
        opts,
      );
      return plainToInstance(
        ScenarioDraftResponseDto,
        { ...draft, model },
        { excludeExtraneousValues: true },
      );
    } catch (err) {
      this.logger.error(`scenario draft failed: ${(err as Error).message}`);
      throw new ServiceUnavailableException(
        'could not draft a scenario, please try again',
      );
    }
  }

  private groqOptions(): GroqRequestOptions {
    return {
      apiKeys: this.config.get<string[]>('groq.apiKeys') ?? [],
      baseUrl: this.config.getOrThrow<string>('groq.baseUrl'),
      model: this.config.getOrThrow<string>('groq.model'),
      timeoutMs: this.config.getOrThrow<number>('groq.timeoutMs'),
    };
  }
}
