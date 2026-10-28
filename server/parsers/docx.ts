import mammoth from 'mammoth';
import { toParagraphLines, type TextLine } from './textBlocks.js';

/** Extracts the plain text of a .docx file, one entry per non-empty paragraph. */
export async function extractDocxLines(path: string): Promise<TextLine[]> {
  const { value } = await mammoth.extractRawText({ path });
  return toParagraphLines(value);
}
