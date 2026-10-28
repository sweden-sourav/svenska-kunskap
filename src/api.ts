import type { AnswerResult, BankStatus, LanguagesResponse, QuestionsResponse } from './types';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json' } });
  } catch {
    throw new Error('Cannot reach the quiz server. Check that it is running.');
  }
  if (!res.ok) {
    let message = `The server returned an error (${res.status}).`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch { /* keep the generic message */ }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export const getQuestions = (lang?: string) =>
  request<QuestionsResponse>(`/api/questions${lang ? `?lang=${encodeURIComponent(lang)}` : ''}`);
export const getLanguages = () => request<LanguagesResponse>('/api/languages');
export const getStatus = () => request<BankStatus>('/api/status');
export const submitAnswer = (questionId: string, choiceId: string, lang?: string) =>
  request<AnswerResult>('/api/answer', { method: 'POST', body: JSON.stringify({ questionId, choiceId, lang }) });
