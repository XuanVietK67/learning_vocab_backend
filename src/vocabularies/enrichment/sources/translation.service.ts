import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { BilingualLexiconEntry } from '@/vocabularies/entities/bilingual-lexicon.entity';

// Matches the translation column / CreateAdminTranslationDto cap.
const TRANSLATION_MAX = 255;

export interface ResolvedTranslation {
  translation: string;
  source: string;
}

/**
 * Resolves a word/sense-level translation without Gemma:
 *   1. bilingual_lexicon lookup (POS-specific row preferred over the generic '');
 *   2. on a miss, the OPUS-MT sidecar (if configured), whose result is written
 *      back into the lexicon so the next request is a cheap lookup.
 * Returns null when nothing resolves, so the caller can fall back (to Gemma
 * during the transition) or leave the field blank/editable. A bad sidecar call
 * never throws — translation must never fail the whole enrichment.
 */
@Injectable()
export class TranslationService {
  private readonly logger = new Logger(TranslationService.name);

  constructor(
    @InjectRepository(BilingualLexiconEntry)
    private readonly repo: Repository<BilingualLexiconEntry>,
    private readonly config: ConfigService,
  ) {}

  async translate(
    sourceLanguage: string,
    targetLanguage: string,
    lemma: string,
    partOfSpeech: string,
  ): Promise<ResolvedTranslation | null> {
    const norm = lemma.trim().toLowerCase();
    if (!norm || !targetLanguage || targetLanguage === sourceLanguage) {
      return null;
    }

    const hit = await this.lookup(
      sourceLanguage,
      targetLanguage,
      norm,
      partOfSpeech,
    );
    if (hit) return hit;

    const mt = await this.translateViaOpusMt(
      sourceLanguage,
      targetLanguage,
      norm,
    );
    if (mt) {
      // Cache MT word-level ('' POS): it carried no POS context, so it should
      // serve every part of speech for this lemma on the next lookup.
      await this.cacheTranslation(sourceLanguage, targetLanguage, norm, mt);
      return { translation: mt, source: 'opus-mt' };
    }
    return null;
  }

  private async lookup(
    sourceLanguage: string,
    targetLanguage: string,
    lemma: string,
    partOfSpeech: string,
  ): Promise<ResolvedTranslation | null> {
    const rows = await this.repo.find({
      where: {
        sourceLanguage,
        targetLanguage,
        lemma,
        partOfSpeech: In([partOfSpeech, '']),
      },
      select: { partOfSpeech: true, translation: true, source: true },
    });
    if (rows.length === 0) return null;
    const exact = rows.find((r) => r.partOfSpeech === partOfSpeech);
    const generic = rows.find((r) => r.partOfSpeech === '');
    const row = exact ?? generic;
    return row ? { translation: row.translation, source: row.source } : null;
  }

  private async translateViaOpusMt(
    sourceLanguage: string,
    targetLanguage: string,
    text: string,
  ): Promise<string | null> {
    const baseUrl = this.config.get<string>('enrichment.opusMtBaseUrl', '');
    if (!baseUrl) return null;

    const timeoutMs = this.config.get<number>(
      'enrichment.opusMtTimeoutMs',
      10_000,
    );
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/translate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text,
          source: sourceLanguage,
          target: targetLanguage,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        this.logger.warn(
          `opus-mt ${res.status} for "${text}" ${sourceLanguage}->${targetLanguage}`,
        );
        return null;
      }
      const body = (await res.json()) as { translation?: unknown };
      const t =
        typeof body.translation === 'string' ? body.translation.trim() : '';
      return t ? t.slice(0, TRANSLATION_MAX) : null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `opus-mt call failed for "${text}" ${sourceLanguage}->${targetLanguage}: ${msg}`,
      );
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  // Write an MT result back into the lexicon as a word-level ('' POS) entry.
  // Idempotent (ON CONFLICT DO NOTHING); a cache write must never fail
  // enrichment, so DB errors are swallowed with a warning.
  private async cacheTranslation(
    sourceLanguage: string,
    targetLanguage: string,
    lemma: string,
    translation: string,
  ): Promise<void> {
    try {
      await this.repo
        .createQueryBuilder()
        .insert()
        .into(BilingualLexiconEntry)
        .values({
          sourceLanguage,
          targetLanguage,
          lemma,
          partOfSpeech: '',
          translation,
          source: 'opus-mt',
        })
        .orIgnore()
        .execute();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `failed to cache opus-mt translation for "${lemma}": ${msg}`,
      );
    }
  }
}
