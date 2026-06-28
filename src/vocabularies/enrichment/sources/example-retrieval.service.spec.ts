import { Repository } from 'typeorm';
import { CorpusSentence } from '@/vocabularies/entities/corpus-sentence.entity';
import {
  ExampleRetrievalService,
  tsSearchConfig,
} from '@/vocabularies/enrichment/sources/example-retrieval.service';

function buildSvc(getRawMany: jest.Mock): {
  svc: ExampleRetrievalService;
  qb: Record<string, jest.Mock>;
} {
  const qb: Record<string, jest.Mock> = {
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    getRawMany,
  };
  const repo = {
    createQueryBuilder: jest.fn().mockReturnValue(qb),
  } as unknown as Repository<CorpusSentence>;
  return { svc: new ExampleRetrievalService(repo), qb };
}

describe('tsSearchConfig', () => {
  it('maps known languages and a region subtag to a Postgres config', () => {
    expect(tsSearchConfig('en')).toBe('english');
    expect(tsSearchConfig('pt-BR')).toBe('portuguese');
  });

  it('falls back to "simple" for unknown languages', () => {
    expect(tsSearchConfig('vi')).toBe('simple');
  });
});

describe('ExampleRetrievalService', () => {
  it('returns the sentence texts, normalizing the lemma and using the FTS config', async () => {
    const getRawMany = jest
      .fn()
      .mockResolvedValue([
        { text: 'She studies medicine.' },
        { text: 'I study at night.' },
      ]);
    const { svc, qb } = buildSvc(getRawMany);

    const result = await svc.retrieve('en', '  Study ', 2);

    expect(result).toEqual(['She studies medicine.', 'I study at night.']);
    expect(qb.andWhere).toHaveBeenCalledWith(expect.any(String), {
      config: 'english',
      lemma: 'study',
    });
    expect(qb.limit).toHaveBeenCalledWith(2);
  });

  it('returns [] without querying for a blank lemma', async () => {
    const getRawMany = jest.fn();
    const { svc } = buildSvc(getRawMany);

    expect(await svc.retrieve('en', '   ', 2)).toEqual([]);
    expect(getRawMany).not.toHaveBeenCalled();
  });

  it('returns [] without querying for a non-positive limit', async () => {
    const getRawMany = jest.fn();
    const { svc } = buildSvc(getRawMany);

    expect(await svc.retrieve('en', 'study', 0)).toEqual([]);
    expect(getRawMany).not.toHaveBeenCalled();
  });
});
