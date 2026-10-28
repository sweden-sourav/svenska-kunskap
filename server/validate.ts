import type { Issue, RawQuestion, StoredQuestion } from './types.js';

const MAX_CHOICES = 8;

type Validated = { question?: Omit<StoredQuestion, 'id'>; issues: Issue[] };

/** Checks one parsed question. Any problem makes the question invalid (it is skipped and reported). */
export function validateQuestion(raw: RawQuestion, file: string): Validated {
  const problems: string[] = [];
  const text = raw.text.trim();
  const choices = raw.choices.map((c) => ({ id: c.id.toUpperCase(), text: c.text.trim() }));

  if (!text) problems.push('question text is empty');

  if (choices.length < 2) problems.push(`needs at least 2 answer choices (found ${choices.length})`);
  else if (choices.length > MAX_CHOICES) problems.push(`has more than ${MAX_CHOICES} answer choices`);

  const ids = choices.map((c) => c.id);
  if (ids.some((id, i) => id !== String.fromCharCode(65 + i))) {
    problems.push(`choices must be labelled A, B, C… in order with no gaps or repeats (found: ${ids.join(', ') || 'none'})`);
  }
  for (const c of choices) if (!c.text) problems.push(`choice ${c.id} is empty`);

  const seen = new Map<string, string>();
  for (const c of choices) {
    const key = c.text.toLowerCase();
    if (!key) continue;
    const earlier = seen.get(key);
    if (earlier) problems.push(`choices ${earlier} and ${c.id} have identical text`);
    else seen.set(key, c.id);
  }

  let correctChoiceId = '';
  const value = raw.correct.trim();
  if (!value) {
    problems.push('correct answer is missing');
  } else {
    const letter = /^\(?([A-Ha-h])[).:]?$/.exec(value);
    const byLetter = letter ? choices.find((c) => c.id === letter[1].toUpperCase()) : undefined;
    const byText = choices.find((c) => c.text.toLowerCase() === value.toLowerCase());
    const match = byLetter ?? byText;
    if (match) correctChoiceId = match.id;
    else problems.push(`correct answer "${value}" must be one choice letter (A–H) or the exact text of one choice`);
  }

  if (problems.length > 0) {
    return {
      issues: problems.map((message) => ({ file, location: raw.location, message: `Question skipped: ${message}`, severity: 'error' as const })),
    };
  }
  return {
    issues: [],
    question: {
      text,
      choices,
      correctChoiceId,
      category: raw.category?.trim() || undefined,
      explanation: raw.explanation?.trim() || undefined,
      translations: raw.translations ?? {},
      file,
    },
  };
}
