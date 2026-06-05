import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { IsNull, Repository } from 'typeorm';
import { VocabularySense } from '@/vocabularies/entities/vocabulary-sense.entity';
import { generateImage } from '@/vocabularies/images/image-generator';
import {
  GenerateImageJobData,
  IMAGE_QUEUE,
} from '@/vocabularies/images/image-queue.constants';

// Concurrency is read from env directly: @Processor decorator options are
// evaluated at class-decoration time, before Nest's DI (and ConfigService)
// exists, so it cannot be injected here.
const CONCURRENCY = parseInt(process.env.IMAGE_WORKER_CONCURRENCY ?? '3', 10);

@Processor(IMAGE_QUEUE, { concurrency: CONCURRENCY })
export class ImageProcessor extends WorkerHost {
  private readonly logger = new Logger(ImageProcessor.name);

  constructor(
    @InjectRepository(VocabularySense)
    private readonly senseRepo: Repository<VocabularySense>,
    private readonly config: ConfigService,
  ) {
    super();
  }

  async process(job: Job<GenerateImageJobData>): Promise<void> {
    const { senseId, lemma, language } = job.data;

    // Idempotency: skip if the sense was deleted or already has an image (a
    // manual value, or a previous run). Never clobber an existing URL.
    const sense = await this.senseRepo.findOne({ where: { id: senseId } });
    if (!sense) {
      this.logger.warn(`sense ${senseId} no longer exists; skipping`);
      return;
    }
    if (sense.imageUrl) {
      return;
    }

    const generated = await generateImage(senseId, lemma, language, lemma, {
      pexelsApiKey: this.config.get<string>('image.pexelsApiKey', ''),
      cloudinary: {
        cloudName: this.config.get<string>('image.cloudinary.cloudName', ''),
        apiKey: this.config.get<string>('image.cloudinary.apiKey', ''),
        apiSecret: this.config.get<string>('image.cloudinary.apiSecret', ''),
      },
      folder: this.config.get<string>(
        'image.cloudinary.folder',
        'vocab-images',
      ),
    });

    if (!generated) {
      // Pexels had no match (common for abstract words). Leave image_url NULL
      // for an admin to fill manually — not an error.
      this.logger.log(`no image match for ${lemma} (sense ${senseId})`);
      return;
    }

    // Re-check image_url is still null before writing, to avoid racing a manual
    // update that landed while we were generating.
    await this.senseRepo.update(
      { id: senseId, imageUrl: IsNull() },
      { imageUrl: generated.url },
    );
    this.logger.log(`image set for ${lemma} (sense ${senseId})`);
  }
}
