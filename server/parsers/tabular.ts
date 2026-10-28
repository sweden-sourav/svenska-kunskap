import type { ParseIssue, ParseResult, QuestionTranslation, RawQuestion } from '../types.js';

export interface TabularRow {
  values: string[];
  /** 1-based row number in the source (the header is row 1 unless the sheet starts lower). */
  row: number;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

const QUESTION = ['question', 'question_text', 'text'];
const CORRECT = ['correct', 'correct_answer', 'correct_choice', 'answer', 'key'];
const CATEGORY = ['category', 'topic'];
const EXPLANATION = ['explanation', 'rationale'];
const CHOICE = /^(?:choice|option|answer)_([a-h])$/;

/**
 * Per-language columns: a base column name plus a language suffix, e.g. question_sv, choice_a_sv,
 * explanation_en, question_pt_br. Language codes are 2–3 letters with an optional region.
 */
const TRANSLATED = /^(question|question_text|text|category|topic|explanation|rationale|(?:choice|option|answer)_[a-h])_([a-z]{2,3}(?:_[a-z0-9]{2,4})?)$/;

export const normalizeLanguage = (code: string) => code.trim().toLowerCase().replace(/_/g, '-');

interface TranslationColumn {
  lang: string;
  field: 'text' | 'category' | 'explanation' | { choice: string };
  index: number;
}

function translationColumn(header: string, index: number): TranslationColumn | undefined {
  const m = TRANSLATED.exec(norm(header));
  if (!m) return undefined;
  const base = m[1];
  const lang = normalizeLanguage(m[2]);
  const choice = CHOICE.exec(base);
  if (choice) return { lang, index, field: { choice: choice[1].toUpperCase() } };
  if (QUESTION.includes(base)) return { lang, index, field: 'text' };
  if (CATEGORY.includes(base)) return { lang, index, field: 'category' };
  return { lang, index, field: 'explanation' };
}

/** Turns header + data rows (from CSV or a worksheet) into raw questions. `label` prefixes locations, e.g. `sheet "Science"`. */
export function parseTabular(rows: TabularRow[], label = ''): ParseResult {
  const issues: ParseIssue[] = [];
  const raws: RawQuestion[] = [];
  const where = (row: number) => `${label ? label + ', ' : ''}row ${row}`;

  const headerRow = rows.find((r) => r.values.some((v) => v.trim() !== ''));
  if (!headerRow) {
    return { raws, issues: [{ location: label || 'file', message: 'No header row found; the file is empty', severity: 'error' }] };
  }

  const col = (names: string[]) => headerRow.values.findIndex((h) => names.includes(norm(h)));
  const qCol = col(QUESTION);
  const aCol = col(CORRECT);
  const catCol = col(CATEGORY);
  const expCol = col(EXPLANATION);
  const choiceCols: { id: string; index: number }[] = [];
  const translationCols: TranslationColumn[] = [];
  headerRow.values.forEach((h, index) => {
    const m = CHOICE.exec(norm(h));
    if (m) {
      if (!choiceCols.some((c) => c.id === m[1].toUpperCase())) choiceCols.push({ id: m[1].toUpperCase(), index });
      return;
    }
    const t = translationColumn(h, index);
    if (t) translationCols.push(t);
  });
  choiceCols.sort((a, b) => a.id.localeCompare(b.id));

  const missing = [
    qCol < 0 && '"question"',
    choiceCols.length < 2 && 'at least two choice columns (choice_a, choice_b, …)',
    aCol < 0 && '"correct"',
  ].filter(Boolean);
  if (missing.length > 0) {
    return {
      raws,
      issues: [{ location: where(headerRow.row), message: `Header row is missing required column(s): ${missing.join(', ')}`, severity: 'error' }],
    };
  }

  const cell = (values: string[], i: number) => (i >= 0 ? (values[i] ?? '').trim() : '');
  for (const r of rows) {
    if (r.row <= headerRow.row || r.values.every((v) => v.trim() === '')) continue;

    const translations: Record<string, QuestionTranslation> = {};
    for (const t of translationCols) {
      const value = cell(r.values, t.index);
      if (!value) continue;
      const entry = (translations[t.lang] ??= {});
      if (t.field === 'text' || t.field === 'category' || t.field === 'explanation') entry[t.field] = value;
      else (entry.choices ??= {})[t.field.choice] = value;
    }

    raws.push({
      text: cell(r.values, qCol),
      choices: choiceCols
        .map((c) => ({ id: c.id, text: cell(r.values, c.index) }))
        // Blank trailing choice cells mean "fewer choices"; blanks in the middle are kept so validation reports them.
        .filter((c, i, all) => c.text !== '' || all.slice(i + 1).some((later) => later.text !== '')),
      correct: cell(r.values, aCol),
      category: cell(r.values, catCol) || undefined,
      explanation: cell(r.values, expCol) || undefined,
      translations,
      location: where(r.row),
    });
  }
  return { raws, issues };
}
