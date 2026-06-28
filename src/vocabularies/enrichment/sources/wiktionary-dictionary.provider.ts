import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DictionaryPosGroup } from '@/vocabularies/enrichment/dictionary-client';
import { EspeakG2pService } from '@/vocabularies/enrichment/sources/espeak-g2p.service';
import { DictionaryEntry } from '@/vocabularies/entities/dictionary-entry.entity';

/**
 * Looks a lemma up in the locally-loaded multilingual dictionary
 * (dictionary_entry) and returns it in the same DictionaryPosGroup shape the
 * English dictionary client produces, so both feed the same draftsFromDictionary
 * path. This is what lets non-English (and English dictionary-miss) words enrich
 * without Gemma. When the entry carries no IPA, falls back to espeak-ng G2P.
 */
@Injectable()
export class WiktionaryDictionaryProvider {
  constructor(
    @InjectRepository(DictionaryEntry)
    private readonly repo: Repository<DictionaryEntry>,
    private readonly espeak: EspeakG2pService,
  ) {}

  async lookup(
    language: string,
    lemma: string,
  ): Promise<DictionaryPosGroup[] | null> {
    const norm = lemma.trim().toLowerCase();
    if (!norm) return null;

    const rows = await this.repo.find({
      where: { language, lemma: norm },
    });
    if (rows.length === 0) return null;

    // Word-level IPA: the first row that has one, else a best-effort G2P pass
    // (applied to every POS group, mirroring the English client).
    let ipa = rows.find((r) => r.ipa)?.ipa ?? null;
    if (!ipa) ipa = await this.espeak.transcribe(norm, language);

    return rows.map((row) => ({
      partOfSpeechRaw: row.partOfSpeech,
      ipa,
      senses: row.senses,
    }));
  }
}
