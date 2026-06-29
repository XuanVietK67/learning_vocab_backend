import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { BilingualLexiconEntry } from '@/vocabularies/entities/bilingual-lexicon.entity';

// Matches the bilingual_lexicon.translation column cap (word-level only).
const TRANSLATION_MAX = 255;

export interface ResolvedTranslation {
  translation: string;
  source: string;
}

interface OpusMtResponse {
  translations?: unknown[];
}

/**
 * Translation without Gemma, backed by a self-hosted OPUS-MT (Marian) sidecar:
 *   - translate(): word/sense-level. bilingual_lexicon lookup first
 *     (POS-specific row preferred over the generic ''); on a miss, the sidecar
 *     translates the lemma and the result is written back into the lexicon, so
 *     the next request is a cheap lookup. Returns null when nothing resolves so
 *     the caller can fall back (to Gemma during the transition).
 *   - translateSentences(): batch sentence translation for example sentences
 *     (no lexicon/cache — sentences aren't word entries; the enrichment cache
 *     dedupes repeats per word).
 * A bad/unreachable sidecar call never throws — translation must never fail
 * enrichment; an empty OPUS_MT_SERVICE_URL disables MT (lexicon-only).
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

    const [mt] = await this.callOpusMt(sourceLanguage, targetLanguage, [norm]);
    if (mt) {
      const capped = mt.slice(0, TRANSLATION_MAX);
      // Cache MT word-level ('' POS): no POS context, so serve every POS next time.
      await this.cacheTranslation(sourceLanguage, targetLanguage, norm, capped);
      return { translation: capped, source: 'opus-mt' };
    }
    return null;
  }

  /**
   * Translate a batch of sentences (example sentences) in one API call. Returns
   * an array aligned to `texts`, with null where a translation isn't available.
   */
  async translateSentences(
    sourceLanguage: string,
    targetLanguage: string,
    texts: string[],
  ): Promise<(string | null)[]> {
    if (!targetLanguage || targetLanguage === sourceLanguage) {
      return texts.map(() => null);
    }
    return this.callOpusMt(sourceLanguage, targetLanguage, texts);
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

  // POST the batch to the OPUS-MT sidecar; returns translations aligned to `q`,
  // null per item on any failure. Disabled (all null) when no service URL is
  // set. Retries cold-start/5xx up to opusMtMaxAttempts; never throws.
  private async callOpusMt(
    sourceLanguage: string,
    targetLanguage: string,
    q: string[],
  ): Promise<(string | null)[]> {
    const url = this.config
      .get<string>('enrichment.opusMtServiceUrl', '')
      .replace(/\/+$/, '');
    if (!url || q.length === 0) return q.map(() => null);

    const token = this.config.get<string>('enrichment.opusMtToken', '');
    const timeoutMs = this.config.get<number>(
      'enrichment.opusMtTimeoutMs',
      15_000,
    );
    const maxAttempts = Math.max(
      1,
      this.config.get<number>('enrichment.opusMtMaxAttempts', 2),
    );

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const result = await this.requestOpusMt(
        url,
        token,
        timeoutMs,
        sourceLanguage,
        targetLanguage,
        q,
      );
      if (result) return result;
      // null result = cold-start/5xx/timeout; back off (2s, 4s, …) and retry.
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }
    return q.map(() => null);
  }

  // One POST attempt. Returns the aligned translations on success, or null to
  // signal a retryable failure (the caller decides whether to retry or give up).
  private async requestOpusMt(
    url: string,
    token: string,
    timeoutMs: number,
    sourceLanguage: string,
    targetLanguage: string,
    q: string[],
  ): Promise<(string | null)[] | null> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${url}/translate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          source: sourceLanguage,
          target: targetLanguage,
          texts: q,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        this.logger.warn(
          `opus-mt ${res.status} for ${sourceLanguage}->${targetLanguage} (${q.length} item(s))`,
        );
        return null;
      }
      const body = (await res.json()) as OpusMtResponse;
      const translations = body.translations ?? [];
      return q.map((_, i) => {
        const t = translations[i];
        return typeof t === 'string' && t.trim() ? t.trim() : null;
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `opus-mt call failed for ${sourceLanguage}->${targetLanguage}: ${msg}`,
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
      this.logger.warn(`failed to cache translation for "${lemma}": ${msg}`);
    }
  }
}
