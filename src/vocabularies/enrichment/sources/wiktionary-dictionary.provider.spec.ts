import { Repository } from 'typeorm';
import { EspeakG2pService } from '@/vocabularies/enrichment/sources/espeak-g2p.service';
import { WiktionaryDictionaryProvider } from '@/vocabularies/enrichment/sources/wiktionary-dictionary.provider';
import { DictionaryEntry } from '@/vocabularies/entities/dictionary-entry.entity';

function buildProvider(
  find: jest.Mock,
  transcribe: jest.Mock = jest.fn(),
): WiktionaryDictionaryProvider {
  const repo = { find } as unknown as Repository<DictionaryEntry>;
  const espeak = { transcribe } as unknown as EspeakG2pService;
  return new WiktionaryDictionaryProvider(repo, espeak);
}

const sense = { definition: 'to learn', synonyms: [], antonyms: [] };

describe('WiktionaryDictionaryProvider', () => {
  it('maps rows to POS groups, applying the row IPA to every group', async () => {
    const find = jest.fn().mockResolvedValue([
      { partOfSpeech: 'verb', ipa: '/estudiˈaɾ/', senses: [sense] },
      { partOfSpeech: 'noun', ipa: null, senses: [sense] },
    ]);
    const transcribe = jest.fn();
    const groups = await buildProvider(find, transcribe).lookup(
      'es',
      'Estudiar',
    );

    expect(groups).toEqual([
      { partOfSpeechRaw: 'verb', ipa: '/estudiˈaɾ/', senses: [sense] },
      { partOfSpeechRaw: 'noun', ipa: '/estudiˈaɾ/', senses: [sense] },
    ]);
    // Had a dictionary IPA, so G2P is not invoked.
    expect(transcribe).not.toHaveBeenCalled();
  });

  it('falls back to espeak G2P when no row carries an IPA', async () => {
    const find = jest
      .fn()
      .mockResolvedValue([
        { partOfSpeech: 'verb', ipa: null, senses: [sense] },
      ]);
    const transcribe = jest.fn().mockResolvedValue('/ɡ2p/');

    const groups = await buildProvider(find, transcribe).lookup(
      'es',
      'estudiar',
    );

    expect(transcribe).toHaveBeenCalledWith('estudiar', 'es');
    expect(groups?.[0].ipa).toBe('/ɡ2p/');
  });

  it('returns null on a miss', async () => {
    expect(
      await buildProvider(jest.fn().mockResolvedValue([])).lookup('es', 'x'),
    ).toBeNull();
  });

  it('returns null for a blank lemma without querying', async () => {
    const find = jest.fn();
    expect(await buildProvider(find).lookup('es', '  ')).toBeNull();
    expect(find).not.toHaveBeenCalled();
  });
});
