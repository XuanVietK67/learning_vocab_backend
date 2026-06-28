import { Repository } from 'typeorm';
import { ProficiencyLevel } from '@/users/entities/proficiency-level.enum';
import { CefrLexiconEntry } from '@/vocabularies/entities/cefr-lexicon.entity';
import { CefrEstimatorService } from '@/vocabularies/enrichment/sources/cefr-estimator.service';

function buildSvc(find: jest.Mock): CefrEstimatorService {
  return new CefrEstimatorService({
    find,
  } as unknown as Repository<CefrLexiconEntry>);
}

describe('CefrEstimatorService', () => {
  it('prefers the exact part-of-speech row and matches the normalized lemma', async () => {
    // The mock only returns rows for the normalized lemma, so a hit proves the
    // estimator lowercased + trimmed the input ("  Study ") before querying.
    const find = jest.fn((opts: { where: { lemma: string } }) =>
      Promise.resolve(
        opts.where.lemma === 'study'
          ? [
              { partOfSpeech: '', cefrLevel: 'B1' },
              { partOfSpeech: 'noun', cefrLevel: 'A2' },
            ]
          : [],
      ),
    );

    const level = await buildSvc(find).estimate('en', '  Study ', 'noun');

    expect(level).toBe(ProficiencyLevel.A2);
  });

  it('falls back to the generic (any-POS) row when no exact POS match', async () => {
    const find = jest
      .fn()
      .mockResolvedValue([{ partOfSpeech: '', cefrLevel: 'C1' }]);

    expect(await buildSvc(find).estimate('en', 'study', 'verb')).toBe(
      ProficiencyLevel.C1,
    );
  });

  it('returns null on a miss', async () => {
    const find = jest.fn().mockResolvedValue([]);
    expect(await buildSvc(find).estimate('en', 'absent', 'noun')).toBeNull();
  });

  it('returns null when the stored level is invalid', async () => {
    const find = jest
      .fn()
      .mockResolvedValue([{ partOfSpeech: 'noun', cefrLevel: 'Z9' }]);
    expect(await buildSvc(find).estimate('en', 'study', 'noun')).toBeNull();
  });

  it('returns null for a blank lemma without querying', async () => {
    const find = jest.fn();
    expect(await buildSvc(find).estimate('en', '   ', 'noun')).toBeNull();
    expect(find).not.toHaveBeenCalled();
  });
});
