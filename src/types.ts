export interface Choice { id: string; text: string }
export interface PublicQuestion { id: string; text: string; category?: string; choices: Choice[] }
export interface AnswerResult { correct: boolean; correctChoiceId: string; explanation?: string }
export interface Submitted { choiceId: string; result: AnswerResult }
export interface BankIssue { file: string; location: string; message: string; severity: 'error' | 'warning' }
export interface BankStatus {
  questionCount: number;
  files: { file: string; loaded: number; skipped: number }[];
  issues: BankIssue[];
}

export interface Language { code: string; name: string; fromFiles: boolean; machine: boolean }
export interface LanguagesResponse { sourceLanguage: string; machineTranslation: boolean; languages: Language[] }
export interface QuestionsResponse {
  language: string;
  machineTranslated: boolean;
  /** Some text could not be translated and is shown in the original language. */
  incomplete: boolean;
  questions: PublicQuestion[];
}
