import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ProficiencyLevel } from '@/users/entities/proficiency-level.enum';
import { CefrLexiconEntry } from '@/vocabularies/entities/cefr-lexicon.entity';

const VALID_CEFR = new Set<string>(Object.values(ProficiencyLevel));

/**
 * Deterministic CEFR lookup over the cefr_lexicon reference wordlist. Replaces
 * Gemma's CEFR guess on the enrichment path: given a lemma + part of speech it
 * returns the band from the wordlist, preferring a POS-specific row over the
 * generic ('' part_of_speech) row, and `null` on a miss so the caller can fall
 * back. Lemma is matched lowercased/trimmed to mirror how the table is loaded.
 */
@Injectable()
export class CefrEstimatorService {
  constructor(
    @InjectRepository(CefrLexiconEntry)
    private readonly repo: Repository<CefrLexiconEntry>,
  ) {}

  async estimate(
    language: string,
    lemma: string,
    partOfSpeech: string,
  ): Promise<ProficiencyLevel | null> {
    const norm = lemma.trim().toLowerCase();
    if (!norm) return null;

    // One query for both the POS-specific and the generic row; pick in code.
    const rows = await this.repo.find({
      where: { language, lemma: norm, partOfSpeech: In([partOfSpeech, '']) },
      select: { partOfSpeech: true, cefrLevel: true },
    });
    if (rows.length === 0) return null;

    const exact = rows.find((r) => r.partOfSpeech === partOfSpeech);
    const generic = rows.find((r) => r.partOfSpeech === '');
    return coerceCefr((exact ?? generic)?.cefrLevel);
  }
}

// Validate a stored band against the enum; an unknown/blank value yields null so
// a bad lexicon row degrades to the caller's fallback rather than persisting junk.
function coerceCefr(value: string | undefined): ProficiencyLevel | null {
  if (!value) return null;
  const cefr = value.trim().toUpperCase();
  return VALID_CEFR.has(cefr) ? (cefr as ProficiencyLevel) : null;
}
