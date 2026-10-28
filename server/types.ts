export type Severity = 'error' | 'warning';

/** A problem found while loading the question bank. */
export interface Issue {
  file: string;
  /** Row, paragraph, page/line or question number inside the file, when known. */
  location: string;
  message: string;
  severity: Severity;
}
export type ParseIssue = Omit<Issue, 'file'>;

export interface Choice {
  id: string; // "A", "B", ...
  text: string;
}

/** Text of one question in another language, taken from per-language columns such as question_sv / choice_a_sv. */
export interface QuestionTranslation {
  text?: string;
  category?: string;
  explanation?: string;
  choices?: Record<string, string>;
}

/** A question exactly as read from a file, before validation. */
export interface RawQuestion {
  text: string;
  choices: Choice[];
  correct: string;
  category?: string;
  explanation?: string;
  /** Per-language text keyed by lowercase language code ("sv", "pt-br"). */
  translations?: Record<string, QuestionTranslation>;
  location: string;
}

export interface ParseResult {
  raws: RawQuestion[];
  issues: ParseIssue[];
}

/** A validated question. correctChoiceId and explanation never leave the server before an answer is submitted. */
export interface StoredQuestion {
  id: string;
  text: string;
  choices: Choice[];
  correctChoiceId: string;
  category?: string;
  explanation?: string;
  translations: Record<string, QuestionTranslation>;
  file: string;
}

/** What the browser receives: no answer key, no explanation. */
export interface PublicQuestion {
  id: string;
  text: string;
  category?: string;
  choices: Choice[];
}

export interface FileReport {
  file: string;
  loaded: number;
  skipped: number;
}

export interface QuestionBank {
  questions: StoredQuestion[];
  issues: Issue[];
  files: FileReport[];
}
