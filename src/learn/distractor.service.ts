import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProficiencyLevel } from '@/users/entities/proficiency-level.enum';
import { VocabularyTranslation } from '@/vocabularies/entities/vocabulary-translation.entity';
import { Vocabulary } from '@/vocabularies/entities/vocabulary.entity';

const CEFR_ORDER: ProficiencyLevel[] = [
  ProficiencyLevel.A1,
  ProficiencyLevel.A2,
  ProficiencyLevel.B1,
  ProficiencyLevel.B2,
  ProficiencyLevel.C1,
  ProficiencyLevel.C2,
];

@Injectable()
export class DistractorService {
  constructor(
    @InjectRepository(Vocabulary)
    private readonly vocabRepo: Repository<Vocabulary>,
    @InjectRepository(VocabularyTranslation)
    private readonly translationRepo: Repository<VocabularyTranslation>,
  ) {}

  // Picks `n` lemmas to use as distractors for `target`.
  // Same partOfSpeech, same language, same CEFR band ± 1, excluding the
  // target itself. Prefers vocab sharing at least one topic. Falls back to
  // any matching POS+language if the strict filter returns too few rows.
  async pickLemmaDistractors(target: Vocabulary, n: number): Promise<string[]> {
    const sameTopicRows = await this.queryCandidates(target, true, n * 3);
    const pool = sameTopicRows.map((r) => r.lemma);
    if (pool.length < n) {
      const wider = await this.queryCandidates(target, false, n * 3);
      for (const r of wider) {
        if (!pool.includes(r.lemma)) pool.push(r.lemma);
        if (pool.length >= n * 3) break;
      }
    }
    return shuffle(pool).slice(0, n);
  }

  // Picks `n` translations (strings in `translationLang`) to use as distractors
  // for a meaning-in-context question. Same translation language, same target
  // language, same POS, same CEFR band, distinct from the target's own
  // translations.
  async pickTranslationDistractors(
    target: Vocabulary,
    translationLang: string,
    excludeTranslations: string[],
    n: number,
  ): Promise<string[]> {
    const candidates = await this.queryCandidates(target, false, n * 5);
    if (candidates.length === 0) return [];

    const candidateIds = candidates.map((c) => c.id);
    const rows = await this.translationRepo
      .createQueryBuilder('t')
      .innerJoin('t.sense', 's')
      .where('s.vocabulary_id IN (:...ids)', { ids: candidateIds })
      .andWhere('t.language = :lang', { lang: translationLang })
      .select('t.translation', 'translation')
      .getRawMany<{ translation: string }>();

    const exclude = new Set(excludeTranslations.map((s) => s.toLowerCase()));
    const pool: string[] = [];
    for (const r of rows) {
      const t = r.translation;
      if (exclude.has(t.toLowerCase())) continue;
      if (!pool.includes(t)) pool.push(t);
      if (pool.length >= n * 3) break;
    }
    return shuffle(pool).slice(0, n);
  }

  private async queryCandidates(
    target: Vocabulary,
    requireSharedTopic: boolean,
    take: number,
  ): Promise<{ id: string; lemma: string }[]> {
    const allowedCefr = neighbouringCefr(target.cefrLevel);
    const qb = this.vocabRepo
      .createQueryBuilder('v')
      .select('v.id', 'id')
      .addSelect('v.lemma', 'lemma')
      .where('v.id != :targetId', { targetId: target.id })
      .andWhere('v.language = :lang', { lang: target.language })
      .andWhere('v.part_of_speech = :pos', { pos: target.partOfSpeech })
      .andWhere("v.source = 'system'");

    if (allowedCefr.length > 0) {
      qb.andWhere('v.cefr_level IN (:...cefrs)', { cefrs: allowedCefr });
    }

    if (requireSharedTopic) {
      qb.andWhere(
        `EXISTS (
          SELECT 1 FROM vocabulary_topics vt_other
          WHERE vt_other.vocabulary_id = v.id
          AND vt_other.topic_id IN (
            SELECT vt_self.topic_id FROM vocabulary_topics vt_self
            WHERE vt_self.vocabulary_id = :targetId2
          )
        )`,
        { targetId2: target.id },
      );
    }

    qb.orderBy('RANDOM()').limit(take);
    return qb.getRawMany<{ id: string; lemma: string }>();
  }
}

function neighbouringCefr(level: ProficiencyLevel | null): ProficiencyLevel[] {
  if (!level) return [];
  const idx = CEFR_ORDER.indexOf(level);
  if (idx < 0) return [level];
  const start = Math.max(0, idx - 1);
  const end = Math.min(CEFR_ORDER.length - 1, idx + 1);
  return CEFR_ORDER.slice(start, end + 1);
}

function shuffle<T>(arr: T[]): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
