import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { Repository } from 'typeorm';
import { BilingualLexiconEntry } from '@/vocabularies/entities/bilingual-lexicon.entity';
import { TranslationService } from '@/vocabularies/enrichment/sources/translation.service';

function buildSvc(opts: {
  find: jest.Mock;
  baseUrl?: string;
  insertExecute?: jest.Mock;
}): TranslationService {
  const qb = {
    insert: jest.fn().mockReturnThis(),
    into: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    orIgnore: jest.fn().mockReturnThis(),
    execute: opts.insertExecute ?? jest.fn().mockResolvedValue(undefined),
  };
  const repo = {
    find: opts.find,
    createQueryBuilder: jest.fn().mockReturnValue(qb),
  } as unknown as Repository<BilingualLexiconEntry>;
  const config = {
    get: jest.fn((key: string, def?: unknown) =>
      key === 'enrichment.opusMtBaseUrl' ? (opts.baseUrl ?? '') : def,
    ),
  } as unknown as ConfigService;
  return new TranslationService(repo, config);
}

describe('TranslationService', () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('returns a lexicon hit, preferring the POS-specific row', async () => {
    const find = jest.fn().mockResolvedValue([
      { partOfSpeech: '', translation: 'chung', source: 'opus-mt' },
      { partOfSpeech: 'verb', translation: 'học', source: 'dictionary' },
    ]);
    const svc = buildSvc({ find });

    expect(await svc.translate('en', 'vi', 'study', 'verb')).toEqual({
      translation: 'học',
      source: 'dictionary',
    });
  });

  it('returns null without translating into the same language', async () => {
    const find = jest.fn();
    expect(
      await buildSvc({ find }).translate('en', 'en', 'study', 'verb'),
    ).toBeNull();
    expect(find).not.toHaveBeenCalled();
  });

  it('returns null on a miss when the OPUS-MT sidecar is not configured', async () => {
    const find = jest.fn().mockResolvedValue([]);
    expect(
      await buildSvc({ find }).translate('en', 'vi', 'study', 'verb'),
    ).toBeNull();
  });

  it('falls back to OPUS-MT on a lexicon miss and caches the result', async () => {
    const find = jest.fn().mockResolvedValue([]);
    const insertExecute = jest.fn().mockResolvedValue(undefined);
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ translation: 'học' }),
    });
    global.fetch = fetchMock;

    const svc = buildSvc({
      find,
      baseUrl: 'http://opus-mt:8000/',
      insertExecute,
    });
    const result = await svc.translate('en', 'vi', 'study', 'verb');

    expect(result).toEqual({ translation: 'học', source: 'opus-mt' });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://opus-mt:8000/translate',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(insertExecute).toHaveBeenCalled();
  });

  it('returns null when the OPUS-MT call throws', async () => {
    const find = jest.fn().mockResolvedValue([]);
    global.fetch = jest.fn().mockRejectedValue(new Error('connrefused'));

    const svc = buildSvc({ find, baseUrl: 'http://opus-mt:8000' });
    expect(await svc.translate('en', 'vi', 'study', 'verb')).toBeNull();
  });
});
