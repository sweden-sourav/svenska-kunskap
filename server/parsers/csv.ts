import type { TabularRow } from './tabular.js';

/** Picks the delimiter (comma, semicolon or tab) that appears most in the header line, ignoring quoted text. */
function detectDelimiter(text: string): string {
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === '\n' || ch === '\r')) break;
    else if (!quoted && ch in counts) counts[ch]++;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

/** RFC 4180 style CSV parser. Handles quoted fields, escaped quotes, embedded newlines, CRLF and a BOM. */
export function parseCsv(input: string): TabularRow[] {
  const text = input.replace(/^\uFEFF/, '');
  const delimiter = detectDelimiter(text);
  const rows: TabularRow[] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;
  let recordNo = 1;

  const endRecord = () => {
    record.push(field);
    rows.push({ values: record, row: recordNo });
    record = [];
    field = '';
    recordNo++;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) { record.push(field); field = ''; }
    else if (ch === '\n') endRecord();
    else if (ch === '\r') { if (text[i + 1] === '\n') i++; endRecord(); }
    else field += ch;
  }
  if (quoted) throw new Error('Unterminated quoted field (a " is never closed)');
  if (field !== '' || record.length > 0) endRecord();
  return rows;
}
