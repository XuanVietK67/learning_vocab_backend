import { PDFParse } from 'pdf-parse';

/**
 * Extract the concatenated plain text from a PDF buffer using pdf-parse (v2,
 * pdfjs-based). The constructor converts the Node Buffer to a Uint8Array
 * internally. Always destroys the parser to release the underlying pdfjs
 * document. The extracted text is handed to the tokenizer for candidate lemmas.
 */
export async function parsePdf(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.text ?? '';
  } finally {
    await parser.destroy();
  }
}
