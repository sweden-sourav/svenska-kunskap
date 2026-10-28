import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { extractDocLines } from './parsers/doc.js';
import { extractDocxLines } from './parsers/docx.js';
import { parseCsv } from './parsers/csv.js';
import { extractPdfLines } from './parsers/pdf.js';
import { parseTabular } from './parsers/tabular.js';
import { parseTextBlocks } from './parsers/textBlocks.js';
import { parseXlsx } from './parsers/xlsx.js';
import type { FileReport, Issue, ParseResult, QuestionBank, StoredQuestion } from './types.js';
import { validateQuestion } from './validate.js';

const PARSERS: Record<string, (path: string) => Promise<ParseResult>> = {
  '.csv': async (p) => parseTabular(parseCsv(await readFile(p, 'utf8'))),
  '.xlsx': (p) => parseXlsx(p),
  '.docx': async (p) => parseTextBlocks(await extractDocxLines(p)),
  '.doc': async (p) => parseTextBlocks(await extractDocLines(p)),
  '.pdf': async (p) => parseTextBlocks(await extractPdfLines(p)),
};

// Files that may sit in the folder without being questions.
const IGNORED = (name: string) => /(^|\/)(\.|~\$)/.test(name) || /\.(md|txt)$/i.test(name);

/** Reads and validates every supported file in `dir` (recursively). Never throws for bad content: problems become issues. */
export async function loadQuestionBank(dir: string): Promise<QuestionBank> {
  const issues: Issue[] = [];
  const files: FileReport[] = [];
  const questions: StoredQuestion[] = [];

  let names: string[];
  try {
    names = await readdir(dir, { recursive: true });
  } catch {
    return { questions, files, issues: [{ file: dir, location: 'folder', message: 'Question folder not found. Create it and add question files.', severity: 'error' }] };
  }

  const candidates: string[] = [];
  for (const name of names.map((n) => n.split('\\').join('/')).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
    if (IGNORED(name) || !(await stat(join(dir, name))).isFile()) continue;
    if (PARSERS[extname(name).toLowerCase()]) candidates.push(name);
    else issues.push({ file: name, location: 'file', message: 'Ignored: unsupported file type (use .csv, .xlsx, .docx, .doc or .pdf)', severity: 'warning' });
  }

  for (const file of candidates) {
    const report: FileReport = { file, loaded: 0, skipped: 0 };
    files.push(report);
    let parsed: ParseResult;
    try {
      parsed = await PARSERS[extname(file).toLowerCase()](join(dir, file));
    } catch (e) {
      issues.push({ file, location: 'file', message: `Could not read file: ${(e as Error).message}`, severity: 'error' });
      continue;
    }
    issues.push(...parsed.issues.map((i) => ({ ...i, file })));
    if (parsed.raws.length === 0 && !parsed.issues.some((i) => i.severity === 'error')) {
      issues.push({ file, location: 'file', message: 'No questions found in this file', severity: 'error' });
    }
    for (const raw of parsed.raws) {
      const { question, issues: problems } = validateQuestion(raw, file);
      if (question) {
        questions.push({ ...question, id: `q${questions.length + 1}` });
        report.loaded++;
      } else {
        issues.push(...problems);
        report.skipped++;
      }
    }
  }
  return { questions, issues, files };
}
