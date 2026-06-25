import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { In, MoreThanOrEqual, Repository } from 'typeorm';
import { GroqRequestOptions } from '@/common/groq/groq-request';
import {
  PaginatedScenarioCardsDto,
  ScenarioCardDto,
} from '@/speaking-room/dto/scenario-card.dto';
import { ScenarioBrowseQueryDto } from '@/speaking-room/dto/scenario-browse-query.dto';
import {
  SessionReportResponseDto,
  SessionStartedDto,
  TurnResultDto,
} from '@/speaking-room/dto/session-response.dto';
import { StartSessionDto } from '@/speaking-room/dto/start-session.dto';
import { TakeTurnDto } from '@/speaking-room/dto/take-turn.dto';
import { ScenarioStatus } from '@/speaking-room/entities/scenario-status.enum';
import { Scenario } from '@/speaking-room/entities/scenario.entity';
import { SpeakingReportStatus } from '@/speaking-room/entities/speaking-report-status.enum';
import { SpeakingSessionStatus } from '@/speaking-room/entities/speaking-session-status.enum';
import { SpeakingSession } from '@/speaking-room/entities/speaking-session.entity';
import { SpeakingTurnRole } from '@/speaking-room/entities/speaking-turn-role.enum';
import { SpeakingTurn } from '@/speaking-room/entities/speaking-turn.entity';
import { generateSessionReport } from '@/speaking-room/session-report';
import { ScenarioSnapshot } from '@/speaking-room/speaking-room.types';
import {
  ConversationContext,
  HistoryTurn,
  takeConversationTurn,
} from '@/speaking-room/speaking-turn';
import { User } from '@/users/entities/user.entity';
import { VocabularySource } from '@/vocabularies/entities/vocabulary-source.enum';
import { Vocabulary } from '@/vocabularies/entities/vocabulary.entity';

// The learner-facing Phase 2 engine: browse published scenarios, run a turn-based
// text conversation (Groq, per-turn), and produce an end-of-session report. Audio
// (STT/TTS) and the streaming WebSocket transport are later milestones; this layer
// is the stable text core they will wrap.
@Injectable()
export class SpeakingSessionService {
  private readonly logger = new Logger(SpeakingSessionService.name);

  constructor(
    @InjectRepository(SpeakingSession)
    private readonly sessionRepo: Repository<SpeakingSession>,
    @InjectRepository(SpeakingTurn)
    private readonly turnRepo: Repository<SpeakingTurn>,
    @InjectRepository(Scenario)
    private readonly scenarioRepo: Repository<Scenario>,
    @InjectRepository(Vocabulary)
    private readonly vocabRepo: Repository<Vocabulary>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly config: ConfigService,
  ) {}

  /**
   * Browse the published scenario catalogue. Optional topic/level filters; when
   * the learner has a CEFR level and didn't pin one, level-matched (and "any"
   * level) scenarios are surfaced first as a light recommendation.
   */
  async browseScenarios(
    userId: string,
    query: ScenarioBrowseQueryDto,
  ): Promise<PaginatedScenarioCardsDto> {
    const qb = this.scenarioRepo
      .createQueryBuilder('s')
      .where('s.status = :status', { status: ScenarioStatus.PUBLISHED });

    if (query.topic) qb.andWhere('s.topic = :topic', { topic: query.topic });
    if (query.cefrLevel) {
      qb.andWhere('s.cefr_level = :level', { level: query.cefrLevel });
    } else {
      const user = await this.userRepo.findOne({ where: { id: userId } });
      if (user?.proficiencyLevel) {
        qb.orderBy(
          'CASE WHEN s.cefr_level = :ulevel THEN 0 WHEN s.cefr_level IS NULL THEN 1 ELSE 2 END',
          'ASC',
        ).setParameter('ulevel', user.proficiencyLevel);
      }
    }

    qb.addOrderBy('s.created_at', 'DESC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit);

    const [rows, total] = await qb.getManyAndCount();
    return plainToInstance(
      PaginatedScenarioCardsDto,
      { data: rows, page: query.page, limit: query.limit, total },
      { excludeExtraneousValues: true },
    );
  }

  /** Fetch one published scenario as a learner-facing card. */
  async getScenarioCard(id: string): Promise<ScenarioCardDto> {
    const scenario = await this.scenarioRepo.findOne({ where: { id } });
    if (!scenario || scenario.status !== ScenarioStatus.PUBLISHED) {
      throw new NotFoundException('scenario not found');
    }
    return plainToInstance(ScenarioCardDto, scenario, {
      excludeExtraneousValues: true,
    });
  }

  /**
   * Start a session: validate the scenario is published, snapshot its spec + the
   * learner's level + chosen words, seed the AI opening line, and return the
   * handle. Words that aren't usable are dropped and reported back.
   */
  async start(
    userId: string,
    dto: StartSessionDto,
  ): Promise<SessionStartedDto> {
    this.assertConfigured();

    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('user not found');

    const scenario = await this.scenarioRepo.findOne({
      where: { id: dto.scenarioId },
    });
    if (!scenario || scenario.status !== ScenarioStatus.PUBLISHED) {
      throw new NotFoundException('scenario not found or not published');
    }

    await this.assertUnderDailySessionCap(userId);

    const { selectedVocabularyIds, selectedWords, inaccessibleVocabularyIds } =
      await this.resolveSelectedWords(userId, dto.vocabularyIds ?? []);

    const snapshot: ScenarioSnapshot = {
      title: scenario.title,
      aiRole: scenario.aiRole,
      userRole: scenario.userRole,
      setting: scenario.setting,
      goal: scenario.goal,
      openingLine: scenario.openingLine,
    };

    const session = await this.sessionRepo.save(
      this.sessionRepo.create({
        userId,
        scenarioId: scenario.id,
        scenarioVersion: scenario.version,
        scenarioSnapshot: snapshot,
        cefrLevel: user.proficiencyLevel ?? scenario.cefrLevel ?? null,
        selectedVocabularyIds,
        selectedWords,
        status: SpeakingSessionStatus.ACTIVE,
        reportStatus: SpeakingReportStatus.PENDING,
      }),
    );

    // Seed turn 0: the AI's scripted opening line (not an LLM call).
    await this.turnRepo.save(
      this.turnRepo.create({
        sessionId: session.id,
        turnIndex: 0,
        role: SpeakingTurnRole.AI,
        text: scenario.openingLine,
        corrections: null,
        usedTargetWords: [],
      }),
    );

    return plainToInstance(
      SessionStartedDto,
      {
        id: session.id,
        scenarioId: session.scenarioId,
        status: session.status,
        cefrLevel: session.cefrLevel,
        selectedWords: session.selectedWords,
        inaccessibleVocabularyIds,
        openingLine: scenario.openingLine,
        createdAt: session.createdAt,
      },
      { excludeExtraneousValues: true },
    );
  }

  /**
   * Take one user turn: append the learner's message, ask the AI for its reply
   * (+ on-screen corrections), persist both, and return the reply. The whole
   * transcript so far is replayed as context so the AI stays coherent.
   */
  async takeTurn(
    userId: string,
    sessionId: string,
    dto: TakeTurnDto,
  ): Promise<TurnResultDto> {
    this.assertConfigured();
    const session = await this.getOwnedSession(userId, sessionId);
    if (session.status === SpeakingSessionStatus.ENDED) {
      throw new BadRequestException('session has ended');
    }

    const turns = await this.turnRepo.find({
      where: { sessionId },
      order: { turnIndex: 'ASC' },
    });

    const userTurnCount = turns.filter(
      (t) => t.role === SpeakingTurnRole.USER,
    ).length;
    const maxTurns = this.config.getOrThrow<number>('groq.maxTurnsPerSession');
    if (userTurnCount >= maxTurns) {
      throw new BadRequestException(
        `turn limit reached (${maxTurns}); please end the session`,
      );
    }

    const history: HistoryTurn[] = turns.map((t) => ({
      role: t.role === SpeakingTurnRole.AI ? 'ai' : 'user',
      text: t.text,
    }));
    const userText = dto.text.trim();

    let reply: TurnResultDto['reply'];
    let corrections: TurnResultDto['corrections'];
    let usedTargetWords: string[];
    try {
      const { turn } = await takeConversationTurn(
        this.conversationContext(session),
        history,
        userText,
        this.chatOptions(),
      );
      reply = turn.reply;
      corrections = turn.corrections;
      usedTargetWords = turn.usedTargetWords;
    } catch (err) {
      this.logger.error(
        `turn failed for session ${sessionId}: ${(err as Error).message}`,
      );
      throw new ServiceUnavailableException(
        'the conversation partner is unavailable, please try again',
      );
    }

    const userTurnIndex = turns.length;
    const aiTurnIndex = turns.length + 1;
    await this.turnRepo.save([
      this.turnRepo.create({
        sessionId,
        turnIndex: userTurnIndex,
        role: SpeakingTurnRole.USER,
        text: userText,
        corrections: null,
        usedTargetWords: [],
      }),
      this.turnRepo.create({
        sessionId,
        turnIndex: aiTurnIndex,
        role: SpeakingTurnRole.AI,
        text: reply,
        corrections: corrections.length > 0 ? corrections : null,
        usedTargetWords,
      }),
    ]);

    return plainToInstance(
      TurnResultDto,
      { turnIndex: aiTurnIndex, reply, corrections, usedTargetWords },
      { excludeExtraneousValues: true },
    );
  }

  /**
   * End a session and produce the feedback report. Idempotent: re-ending a
   * finished session returns the stored report (regenerating it if a prior
   * generation failed).
   */
  async end(
    userId: string,
    sessionId: string,
  ): Promise<SessionReportResponseDto> {
    const session = await this.getOwnedSession(userId, sessionId);

    if (session.status === SpeakingSessionStatus.ACTIVE) {
      session.status = SpeakingSessionStatus.ENDED;
      session.endedAt = new Date();
      await this.sessionRepo.save(session);
    }
    if (session.reportStatus !== SpeakingReportStatus.READY) {
      await this.generateAndStoreReport(session);
    }
    return this.toReportDto(session);
  }

  /** Fetch the report; retries generation if it isn't ready yet. */
  async getReport(
    userId: string,
    sessionId: string,
  ): Promise<SessionReportResponseDto> {
    const session = await this.getOwnedSession(userId, sessionId);
    if (session.status === SpeakingSessionStatus.ACTIVE) {
      throw new BadRequestException('session has not ended yet');
    }
    if (session.reportStatus !== SpeakingReportStatus.READY) {
      await this.generateAndStoreReport(session);
    }
    return this.toReportDto(session);
  }

  // Generate the report over the full transcript and store it on the session.
  // Never throws: a failure is recorded as `failed` so the client can retry via
  // GET without the session being left in a broken state.
  private async generateAndStoreReport(
    session: SpeakingSession,
  ): Promise<void> {
    const turns = await this.turnRepo.find({
      where: { sessionId: session.id },
      order: { turnIndex: 'ASC' },
    });
    const snapshot = session.scenarioSnapshot;

    try {
      const { report, model } = await generateSessionReport(
        {
          aiRole: snapshot.aiRole,
          userRole: snapshot.userRole,
          setting: snapshot.setting,
          goal: snapshot.goal,
          cefrLevel: session.cefrLevel,
          selectedWords: session.selectedWords,
        },
        turns.map((t) => ({
          role: t.role === SpeakingTurnRole.AI ? 'ai' : 'user',
          text: t.text,
        })),
        this.reportOptions(),
      );
      session.report = report;
      session.reportStatus = SpeakingReportStatus.READY;
      session.reportModel = model;
    } catch (err) {
      session.reportStatus = SpeakingReportStatus.FAILED;
      this.logger.error(
        `report generation failed for session ${session.id}: ${(err as Error).message}`,
      );
    }
    await this.sessionRepo.save(session);
  }

  private toReportDto(session: SpeakingSession): SessionReportResponseDto {
    return plainToInstance(
      SessionReportResponseDto,
      {
        sessionId: session.id,
        reportStatus: session.reportStatus,
        report: session.report,
        reportModel: session.reportModel,
      },
      { excludeExtraneousValues: true },
    );
  }

  private conversationContext(session: SpeakingSession): ConversationContext {
    const s = session.scenarioSnapshot;
    return {
      aiRole: s.aiRole,
      userRole: s.userRole,
      setting: s.setting,
      goal: s.goal,
      cefrLevel: session.cefrLevel,
      selectedWords: session.selectedWords,
    };
  }

  private async getOwnedSession(
    userId: string,
    sessionId: string,
  ): Promise<SpeakingSession> {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId, userId },
    });
    if (!session) throw new NotFoundException('session not found');
    return session;
  }

  // Validate the ticked words, keeping the caller's order. Drops words that
  // don't exist or aren't practiceable; resolves the rest to lemmas snapshotted
  // onto the session. Mirrors PracticeService.buildSet's accessibility rule.
  private async resolveSelectedWords(
    userId: string,
    requested: string[],
  ): Promise<{
    selectedVocabularyIds: string[];
    selectedWords: string[];
    inaccessibleVocabularyIds: string[];
  }> {
    const ids = [...new Set(requested)];
    if (ids.length === 0) {
      return {
        selectedVocabularyIds: [],
        selectedWords: [],
        inaccessibleVocabularyIds: [],
      };
    }

    const vocabs = await this.vocabRepo.find({ where: { id: In(ids) } });
    const accessible = new Map(
      vocabs
        .filter((v) => this.isPracticeable(v, userId))
        .map((v) => [v.id, v]),
    );

    const selectedVocabularyIds = ids.filter((id) => accessible.has(id));
    return {
      selectedVocabularyIds,
      selectedWords: selectedVocabularyIds.map(
        (id) => accessible.get(id)!.lemma,
      ),
      inaccessibleVocabularyIds: ids.filter((id) => !accessible.has(id)),
    };
  }

  // A word is usable if it's an approved system word or the user's own.
  private isPracticeable(vocab: Vocabulary, userId: string): boolean {
    if (vocab.source === VocabularySource.SYSTEM) return vocab.isApproved;
    return vocab.createdByUserId === userId;
  }

  private async assertUnderDailySessionCap(userId: string): Promise<void> {
    const cap = this.config.getOrThrow<number>('groq.dailySessionsPerUser');
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const usedToday = await this.sessionRepo.count({
      where: { userId, createdAt: MoreThanOrEqual(startOfDay) },
    });
    if (usedToday >= cap) {
      throw new HttpException(
        `daily speaking-session limit reached (${cap}/day)`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private assertConfigured(): void {
    if (this.chatOptions().apiKeys.length === 0) {
      throw new ServiceUnavailableException('speaking room is not configured');
    }
  }

  private chatOptions(): GroqRequestOptions {
    return {
      apiKeys: this.config.get<string[]>('groq.apiKeys') ?? [],
      baseUrl: this.config.getOrThrow<string>('groq.baseUrl'),
      model: this.config.getOrThrow<string>('groq.chatModel'),
      timeoutMs: this.config.getOrThrow<number>('groq.timeoutMs'),
    };
  }

  private reportOptions(): GroqRequestOptions {
    return {
      apiKeys: this.config.get<string[]>('groq.apiKeys') ?? [],
      baseUrl: this.config.getOrThrow<string>('groq.baseUrl'),
      model: this.config.getOrThrow<string>('groq.reportModel'),
      timeoutMs: this.config.getOrThrow<number>('groq.timeoutMs'),
    };
  }
}
