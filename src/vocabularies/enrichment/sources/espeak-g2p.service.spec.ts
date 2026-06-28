import { EspeakG2pService } from '@/vocabularies/enrichment/sources/espeak-g2p.service';

describe('EspeakG2pService', () => {
  const svc = new EspeakG2pService();

  it('returns null for an unmapped language without invoking espeak', async () => {
    // 'zz' has no voice mapping, so it short-circuits before any exec attempt.
    expect(await svc.transcribe('palabra', 'zz')).toBeNull();
  });

  it('returns null for a blank word', async () => {
    expect(await svc.transcribe('   ', 'en')).toBeNull();
  });
});
