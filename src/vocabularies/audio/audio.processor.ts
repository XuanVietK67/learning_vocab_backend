import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { IsNull, Repository } from 'typeorm';
import {
  AUDIO_QUEUE,
  GenerateAudioJobData,
} from '@/vocabularies/audio/audio-queue.constants';
import { generateAudio } from '@/vocabularies/audio/audio-generator';
import { Vocabulary } from '@/vocabularies/entities/vocabulary.entity';

// Concurrency is read from env directly: @Processor decorator options are
// evaluated at class-decoration time, before Nest's DI (and ConfigService)
// exists, so it cannot be injected here.
const CONCURRENCY = parseInt(process.env.AUDIO_WORKER_CONCURRENCY ?? '5', 10);

@Processor(AUDIO_QUEUE, { concurrency: CONCURRENCY })
export class AudioProcessor extends WorkerHost {
  private readonly logger = new Logger(AudioProcessor.name);

  constructor(
    @InjectRepository(Vocabulary)
    private readonly vocabRepo: Repository<Vocabulary>,
    private readonly config: ConfigService,
  ) {
    super();
  }

  async process(job: Job<GenerateAudioJobData>): Promise<void> {
    const { vocabId, lemma, language } = job.data;

    // Idempotency: skip if the row was deleted or already has audio (e.g. a
    // manual value, or a previous run). Never clobber an existing URL.
    const vocab = await this.vocabRepo.findOne({ where: { id: vocabId } });
    if (!vocab) {
      this.logger.warn(`vocab ${vocabId} no longer exists; skipping`);
      return;
    }
    if (vocab.audioUrl) {
      return;
    }

    const { url, via } = await generateAudio(vocabId, lemma, language, {
      cloudinary: {
        cloudName: this.config.get<string>('audio.cloudinary.cloudName', ''),
        apiKey: this.config.get<string>('audio.cloudinary.apiKey', ''),
        apiSecret: this.config.get<string>('audio.cloudinary.apiSecret', ''),
      },
      folder: this.config.get<string>('audio.cloudinary.folder', 'vocab-audio'),
      ttsVoice: this.config.get<string>('audio.ttsVoice', 'en-US-AriaNeural'),
    });

    // Re-check audioUrl is still null before writing, to avoid racing a manual
    // update that landed while we were generating.
    await this.vocabRepo.update(
      { id: vocabId, audioUrl: IsNull() },
      { audioUrl: url },
    );
    this.logger.log(`audio set for ${lemma} (${vocabId}) [${via}]`);
  }
}
