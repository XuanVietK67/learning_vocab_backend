// Locales we accept on the wire and the Azure locale each resolves to.
// Azure Pronunciation Assessment grades against exactly one locale per call, so
// the coarse `en` is resolved to a concrete default (en-US) before the request.
const LOCALE_MAP: Record<string, string> = {
  en: 'en-US',
  'en-US': 'en-US',
  'en-GB': 'en-GB',
};

export const SUPPORTED_LOCALES = Object.keys(LOCALE_MAP);

/**
 * Resolve a client-supplied (or default) locale to a concrete Azure locale.
 * Returns null when the value is not supported, so callers can 400.
 */
export function normalizeLocale(locale: string): string | null {
  return LOCALE_MAP[locale] ?? null;
}
