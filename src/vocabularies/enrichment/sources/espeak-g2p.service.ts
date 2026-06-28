import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Injectable, Logger } from '@nestjs/common';

const execFileAsync = promisify(execFile);
const ESPEAK_TIMEOUT_MS = 5000;

// App language code (ISO 639-1) -> espeak-ng voice. Only languages we map are
// attempted; everything else returns null (no IPA rather than a wrong one).
const ESPEAK_VOICE: Record<string, string> = {
  en: 'en',
  es: 'es',
  fr: 'fr',
  de: 'de',
  pt: 'pt',
  it: 'it',
  ru: 'ru',
  nl: 'nl',
  sv: 'sv',
  da: 'da',
  fi: 'fi',
  ro: 'ro',
  hu: 'hu',
  tr: 'tr',
  vi: 'vi',
};

/**
 * Best-effort grapheme-to-phoneme via the `espeak-ng` CLI, used only as the last
 * IPA fallback when no dictionary IPA is available. Entirely optional: if the
 * binary is not installed (or anything fails) it returns null and enrichment
 * proceeds with no IPA. Uses execFile (no shell) so the lemma is never
 * interpolated into a command string.
 */
@Injectable()
export class EspeakG2pService {
  private readonly logger = new Logger(EspeakG2pService.name);

  async transcribe(text: string, language: string): Promise<string | null> {
    const voice = ESPEAK_VOICE[language.trim().toLowerCase().split('-')[0]];
    const word = text.trim();
    if (!voice || !word) return null;

    try {
      const { stdout } = await execFileAsync(
        'espeak-ng',
        ['-q', '--ipa', '-v', voice, word],
        { timeout: ESPEAK_TIMEOUT_MS },
      );
      const ipa = stdout.trim().replace(/\s+/g, ' ');
      if (!ipa) return null;
      // espeak emits bare phonemes; wrap in the /…/ delimiters we store.
      return `/${ipa.replace(/^\/+|\/+$/g, '')}/`;
    } catch (err) {
      // Binary missing or call failed — IPA is optional, so degrade silently.
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.debug(
        `espeak-ng unavailable for "${word}" (${language}): ${msg}`,
      );
      return null;
    }
  }
}
