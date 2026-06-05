import { parsePdf } from '@/vocabularies/enrichment/import/pdf-parser';
import {
  ExtractMode,
  tokenize,
  TokenizeResult,
} from '@/vocabularies/enrichment/import/tokenize';
import { parseSpreadsheet } from '@/vocabularies/enrichment/import/xlsx-parser';

/** The source format an upload/paste came in as. */
export type SourceKind = 'text' | 'csv' | 'xlsx' | 'pdf';

export interface ExtractInput {
  kind: SourceKind;
  mode: ExtractMode;
  buffer?: Buffer;
  text?: string;
}

/**
 * Turn an uploaded file (or pasted text) into candidate lemmas. Format-specific
 * parsing → a single text blob → the shared tokenizer. Pure orchestration with
 * no NestJS/DB; the caller validates input presence and handles DB-level
 * catalog de-duplication afterwards.
 */
export async function extractCandidates(
  input: ExtractInput,
): Promise<TokenizeResult> {
  const rawText = await readSourceText(input);
  return tokenize(rawText, input.mode);
}

async function readSourceText(input: ExtractInput): Promise<string> {
  switch (input.kind) {
    case 'xlsx':
    case 'csv': {
      if (!input.buffer) throw new Error('spreadsheet upload requires a file');
      // Each cell becomes its own line so list-mode tokenizing treats it as one
      // entry; prose mode (rare for a sheet) still works on the joined text.
      return parseSpreadsheet(input.buffer).join('\n');
    }
    case 'pdf': {
      if (!input.buffer) throw new Error('pdf upload requires a file');
      return parsePdf(input.buffer);
    }
    case 'text':
    default:
      return input.text ?? '';
  }
}
