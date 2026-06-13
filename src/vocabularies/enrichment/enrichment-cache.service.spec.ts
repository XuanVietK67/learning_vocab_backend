import { Logger } from '@nestjs/common';
import { Repository } from 'typeorm';
import { VocabEnrichmentCache } from '@/vocabularies/entities/vocab-enrichment-cache.entity';
import { EnrichmentCacheService } from '@/vocabularies/enrichment/enrichment-cache.service';
import { DraftInput } from '@/vocabularies/enrichment/enrichment-draft.types';
import { PartOfSpeech } from '@/vocabularies/entities/part-of-speech.enum';
import { ProficiencyLevel } from '@/users/entities/proficiency-level.enum';

const sampleContent: DraftInput[] = [
  {
    partOfSpeech: PartOfSpeech.NOUN,
    ipa: '/rʌn/',
    cefrLevel: ProficiencyLevel.B1,
    senses: [{ definition: 'an act of running', examples: [] }],
  },
];

describe('EnrichmentCacheService', () => {
  beforeAll(() => {
    // Silence the swallowed-error warning in the put() failure test.
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterAll(() => jest.restoreAllMocks());

  describe('get', () => {
    it('normalizes a null translation language to "" in the lookup', async () => {
      const findOne = jest.fn().mockResolvedValue({ content: sampleContent });
      const svc = new EnrichmentCacheService({
        findOne,
      } as unknown as Repository<VocabEnrichmentCache>);

      const result = await svc.get('en', 'run', null);

      expect(result).toEqual(sampleContent);
      expect(findOne).toHaveBeenCalledWith({
        where: { language: 'en', lemma: 'run', translationLanguage: '' },
        select: { content: true },
      });
    });

    it('returns null on a miss', async () => {
      const findOne = jest.fn().mockResolvedValue(null);
      const svc = new EnrichmentCacheService({
        findOne,
      } as unknown as Repository<VocabEnrichmentCache>);

      expect(await svc.get('en', 'absent', 'vi')).toBeNull();
    });
  });

  describe('put', () => {
    function buildRepo(execute: jest.Mock) {
      const values = jest.fn().mockReturnThis();
      const qb = {
        insert: jest.fn().mockReturnThis(),
        into: jest.fn().mockReturnThis(),
        values,
        orIgnore: jest.fn().mockReturnThis(),
        execute,
      };
      const repo = {
        createQueryBuilder: jest.fn().mockReturnValue(qb),
      } as unknown as Repository<VocabEnrichmentCache>;
      return { repo, values };
    }

    it('inserts with the normalized key and provenance', async () => {
      const execute = jest.fn().mockResolvedValue(undefined);
      const { repo, values } = buildRepo(execute);
      const svc = new EnrichmentCacheService(repo);

      await svc.put('en', 'run', null, sampleContent, 'gemini-2.5-flash-lite');

      expect(values).toHaveBeenCalledWith({
        language: 'en',
        lemma: 'run',
        translationLanguage: '',
        content: sampleContent,
        model: 'gemini-2.5-flash-lite',
      });
      expect(execute).toHaveBeenCalled();
    });

    it('swallows DB errors so a cache write never fails enrichment', async () => {
      const execute = jest.fn().mockRejectedValue(new Error('db down'));
      const { repo } = buildRepo(execute);
      const svc = new EnrichmentCacheService(repo);

      await expect(
        svc.put('en', 'run', 'vi', sampleContent, 'm'),
      ).resolves.toBeUndefined();
    });
  });
});
