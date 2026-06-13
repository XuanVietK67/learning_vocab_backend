import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { VocabEnrichmentCache } from '@/vocabularies/entities/vocab-enrichment-cache.entity';
import { DraftInput } from '@/vocabularies/enrichment/enrichment-draft.types';

/**
 * Read/write side of the persistent enrichment cache. Keyed by (language,
 * lemma, translation_language), it stores the full DraftInput[] the pipeline
 * produced so the worker can replay it without touching the dictionary API or
 * Gemma. A null translation language (no translation requested) is normalized
 * to '' so it participates cleanly in the unique key.
 */
@Injectable()
export class EnrichmentCacheService {
  private readonly logger = new Logger(EnrichmentCacheService.name);

  constructor(
    @InjectRepository(VocabEnrichmentCache)
    private readonly repo: Repository<VocabEnrichmentCache>,
  ) {}

  private normalizeKey(
    language: string,
    lemma: string,
    translationLanguage: string | null,
  ): Pick<VocabEnrichmentCache, 'language' | 'lemma' | 'translationLanguage'> {
    return { language, lemma, translationLanguage: translationLanguage ?? '' };
  }

  /** Cached drafts for this word, or null on a miss. */
  async get(
    language: string,
    lemma: string,
    translationLanguage: string | null,
  ): Promise<DraftInput[] | null> {
    const row = await this.repo.findOne({
      where: this.normalizeKey(language, lemma, translationLanguage),
      select: { content: true },
    });
    return row ? row.content : null;
  }

  /**
   * Store the drafts for this word. Idempotent: a concurrent job that already
   * wrote the same key wins and this insert is ignored (ON CONFLICT DO NOTHING),
   * so two parallel misses for the same word never collide. A cache write must
   * never fail the enrichment itself, so DB errors are swallowed with a warning.
   */
  async put(
    language: string,
    lemma: string,
    translationLanguage: string | null,
    content: DraftInput[],
    model: string,
  ): Promise<void> {
    try {
      await this.repo
        .createQueryBuilder()
        .insert()
        .into(VocabEnrichmentCache)
        .values({
          ...this.normalizeKey(language, lemma, translationLanguage),
          content,
          model,
        })
        .orIgnore()
        .execute();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `failed to cache enrichment for "${lemma}" (${language}): ${msg}`,
      );
    }
  }
}
