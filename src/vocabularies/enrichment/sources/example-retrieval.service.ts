import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CorpusSentence } from '@/vocabularies/entities/corpus-sentence.entity';

// Postgres full-text-search config per language. It drives stemming, so an
// inflected form ("studies"/"studying") matches the lemma "study". Unknown
// languages fall back to 'simple' (exact lexemes, no stemming). This MUST match
// the config used to build search_vector at ingest, or the @@ match silently
// returns nothing — ingest-corpus.ts imports this same helper.
const TS_CONFIG: Record<string, string> = {
  en: 'english',
  es: 'spanish',
  fr: 'french',
  de: 'german',
  pt: 'portuguese',
  it: 'italian',
  nl: 'dutch',
  ru: 'russian',
  sv: 'swedish',
  da: 'danish',
  fi: 'finnish',
  ro: 'romanian',
  hu: 'hungarian',
  tr: 'turkish',
};

export function tsSearchConfig(language: string): string {
  const base = language.trim().toLowerCase().split('-')[0];
  return TS_CONFIG[base] ?? 'simple';
}

/**
 * Retrieves real example sentences for a lemma from the corpus_sentence table
 * (a concordance), replacing Gemma's example generation. Full-text search
 * matches inflected forms via the language's stemming config; results are
 * ordered by the precomputed GDEX score so the cleanest sentences win, and an
 * empty list on a miss lets the caller leave the field blank/editable.
 */
@Injectable()
export class ExampleRetrievalService {
  constructor(
    @InjectRepository(CorpusSentence)
    private readonly repo: Repository<CorpusSentence>,
  ) {}

  async retrieve(
    language: string,
    lemma: string,
    limit: number,
  ): Promise<string[]> {
    const norm = lemma.trim().toLowerCase();
    if (!norm || limit <= 0) return [];

    const rows = await this.repo
      .createQueryBuilder('s')
      .select('s.text', 'text')
      .where('s.language = :language', { language })
      .andWhere(
        's.search_vector @@ plainto_tsquery(:config::regconfig, :lemma)',
        { config: tsSearchConfig(language), lemma: norm },
      )
      .orderBy('s.gdex_score', 'DESC')
      .addOrderBy('s.id', 'ASC')
      .limit(limit)
      .getRawMany<{ text: string }>();

    return rows.map((r) => r.text);
  }
}
