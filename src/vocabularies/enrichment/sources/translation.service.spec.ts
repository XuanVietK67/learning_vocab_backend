import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { Repository } from 'typeorm';
import { BilingualLexiconEntry } from '@/vocabularies/entities/bilingual-lexicon.entity';
import { TranslationService } from '@/vocabularies/enrichment/sources/translation.service';

function buildSvc(opts: {
  find: jest.Mock;
  serviceUrl?: string;
  token?: string;
  maxAttempts?: number;
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
    get: jest.fn((key: string, def?: unknown) => {
      switch (key) {
        case 'enrichment.opusMtServiceUrl':
          return opts.serviceUrl ?? '';
        case 'enrichment.opusMtToken':
          return opts.token ?? '';
        case 'enrichment.opusMtMaxAttempts':
          return opts.maxAttempts ?? 1;
        default:
          return def;
      }
    }),
  } as unknown as ConfigService;
  return new TranslationService(repo, config);
}

function sidecarOk(texts: (string | null)[]): jest.Mock {
  return jest.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ translations: texts }),
  });
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

    expect(
      await buildSvc({ find }).translate('en', 'vi', 'study', 'verb'),
    ).toEqual({ translation: 'học', source: 'dictionary' });
  });

  it('returns null without translating into the same language', async () => {
    const find = jest.fn();
    expect(
      await buildSvc({ find }).translate('en', 'en', 'study', 'verb'),
    ).toBeNull();
    expect(find).not.toHaveBeenCalled();
  });

  it('returns null on a miss when no service URL is configured', async () => {
    const find = jest.fn().mockResolvedValue([]);
    const fetchMock = jest.fn();
    global.fetch = fetchMock;
    expect(
      await buildSvc({ find }).translate('en', 'vi', 'study', 'verb'),
    ).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to the sidecar on a lexicon miss and caches the result', async () => {
    const find = jest.fn().mockResolvedValue([]);
    const insertExecute = jest.fn().mockResolvedValue(undefined);
    const fetchMock = sidecarOk(['học']);
    global.fetch = fetchMock;

    const svc = buildSvc({
      find,
      serviceUrl: 'http://opus-mt:8001',
      token: 'secret',
      insertExecute,
    });
    const result = await svc.translate('en', 'vi', 'study', 'verb');

    expect(result).toEqual({ translation: 'học', source: 'opus-mt' });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://opus-mt:8001/translate',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: 'Bearer secret',
        },
      }),
    );
    expect(insertExecute).toHaveBeenCalled();
  });

  it('returns null when the sidecar call throws', async () => {
    const find = jest.fn().mockResolvedValue([]);
    global.fetch = jest.fn().mockRejectedValue(new Error('unreachable'));

    expect(
      await buildSvc({
        find,
        serviceUrl: 'http://opus-mt:8001',
      }).translate('en', 'vi', 'study', 'verb'),
    ).toBeNull();
  });

  describe('translateSentences', () => {
    it('batch-translates, returning results aligned to the input', async () => {
      global.fetch = sidecarOk(['Cô ấy học y khoa.', 'Tôi học vào buổi tối.']);

      const svc = buildSvc({
        find: jest.fn(),
        serviceUrl: 'http://opus-mt:8001',
      });
      const out = await svc.translateSentences('en', 'vi', [
        'She studies medicine.',
        'I study at night.',
      ]);

      expect(out).toEqual(['Cô ấy học y khoa.', 'Tôi học vào buổi tối.']);
    });

    it('returns all-null without calling out for the same language', async () => {
      const fetchMock = jest.fn();
      global.fetch = fetchMock;

      expect(
        await buildSvc({ find: jest.fn() }).translateSentences('en', 'en', [
          'a',
          'b',
        ]),
      ).toEqual([null, null]);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
