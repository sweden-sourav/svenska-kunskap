import { readFile } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { TextLine } from './textBlocks.js';

/** Extracts text from a text-based PDF, rebuilding lines from item positions. Scanned (image-only) PDFs have no text. */
export async function extractPdfLines(path: string): Promise<TextLine[]> {
  const data = new Uint8Array(await readFile(path));
  const pdf = await getDocument({ data, useSystemFonts: true, isEvalSupported: false, verbosity: 0 }).promise;
  const out: TextLine[] = [];
  try {
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      let line = '';
      let lastY: number | null = null;
      let n = 0;
      const flush = () => {
        if (line.trim()) out.push({ text: line, loc: `page ${p}, line ${++n}` });
        line = '';
      };
      for (const item of content.items) {
        if (!('str' in item)) continue;
        const y = item.transform[5];
        if (lastY !== null && Math.abs(y - lastY) > 2) flush();
        line += item.str;
        lastY = y;
        if (item.hasEOL) { flush(); lastY = null; }
      }
      flush();
      page.cleanup();
    }
  } finally {
    await pdf.destroy();
  }
  return out;
}
