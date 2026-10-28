import type { ParseIssue, ParseResult, RawQuestion } from '../types.js';

export interface TextLine {
  text: string;
  /** Human-readable position used in error messages, e.g. "paragraph 12" or "page 2, line 5". */
  loc: string;
}

/** Splits extracted text into non-empty lines numbered as paragraphs. */
export function toParagraphLines(text: string): TextLine[] {
  const out: TextLine[] = [];
  let n = 0;
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    n++;
    out.push({ text: line, loc: `paragraph ${n}` });
  }
  return out;
}

const QUESTION = /^Q(?:uestion)?\s*\d*\s*[:.)]\s*(.*)$/i;
const CHOICE = /^\(?([A-H])[).:]\s+(.*)$/;
const ANSWER = /^(?:Answer|Correct(?:\s+answer)?|Ans)\s*:\s*(.*)$/i;
const CATEGORY = /^(?:Category|Topic)\s*:\s*(.*)$/i;
const EXPLANATION = /^(?:Explanation|Rationale)\s*:\s*(.*)$/i;

type Field = 'question' | 'choice' | 'answer' | 'category' | 'explanation';

/**
 * Parses the text layout shared by DOCX, DOC and PDF files:
 *
 *   Q: question text
 *   A) choice
 *   B) choice
 *   Answer: B
 *   Category: optional
 *   Explanation: optional
 *
 * Blank lines are ignored. Lines that are not a marker continue the previous field.
 */
export function parseTextBlocks(lines: TextLine[]): ParseResult {
  const raws: RawQuestion[] = [];
  const issues: ParseIssue[] = [];
  let cur: RawQuestion | null = null;
  let field: Field | null = null;
  let answerSeen = false;
  let count = 0;
  let strayReported = false;

  for (const { text, loc } of lines) {
    const t = text.trim();
    if (!t) continue;
    let m: RegExpExecArray | null;

    if ((m = QUESTION.exec(t))) {
      count++;
      cur = { text: m[1], choices: [], correct: '', location: `question #${count}, ${loc}` };
      raws.push(cur);
      field = 'question';
      answerSeen = false;
      strayReported = false;
      continue;
    }
    if (!cur) {
      if (!strayReported) {
        issues.push({ location: loc, message: 'Text outside a question block was ignored (each question must start with "Q:")', severity: 'warning' });
        strayReported = true;
      }
      continue;
    }
    if ((m = ANSWER.exec(t))) { cur.correct = m[1]; field = 'answer'; answerSeen = true; continue; }
    if ((m = CATEGORY.exec(t))) { cur.category = m[1]; field = 'category'; continue; }
    if ((m = EXPLANATION.exec(t))) { cur.explanation = m[1]; field = 'explanation'; continue; }
    if (!answerSeen && (m = CHOICE.exec(t))) {
      cur.choices.push({ id: m[1], text: m[2] });
      field = 'choice';
      continue;
    }

    // Continuation of the previous field (wrapped text).
    const join = (a: string | undefined, b: string) => (a ? `${a} ${b}` : b);
    if (field === 'question') cur.text = join(cur.text, t);
    else if (field === 'choice') cur.choices[cur.choices.length - 1].text = join(cur.choices[cur.choices.length - 1].text, t);
    else if (field === 'answer') cur.correct = join(cur.correct, t);
    else if (field === 'category') cur.category = join(cur.category, t);
    else if (field === 'explanation') cur.explanation = join(cur.explanation, t);
  }
  return { raws, issues };
}
