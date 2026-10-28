import { normalizeLanguage } from './parsers/tabular.js';
import type { PublicQuestion, StoredQuestion } from './types.js';

export class UnsupportedLanguageError extends Error {}

interface LtLanguage { code: string; name: string; targets?: string[] }
interface MachineLanguage { code: string; ltCode: string; name: string }

export interface LanguageInfo {
  code: string;
  name: string;
  /** Some or all text for this language is written in the question files (per-language columns). */
  fromFiles: boolean;
  /** LibreTranslate can translate into this language. */
  machine: boolean;
}

export interface TranslatedQuestions {
  language: string;
  questions: PublicQuestion[];
  /** At least one text came from LibreTranslate. */
  machineTranslated: boolean;
  /** At least one text is still in the original language because no translation was available. */
  incomplete: boolean;
}

/** Thin HTTP client for a self-hosted LibreTranslate server (https://github.com/LibreTranslate/LibreTranslate). */
export class LibreTranslateClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey?: string,
    private readonly timeoutMs = 20_000,
  ) {}

  private url(path: string) {
    return `${this.baseUrl.replace(/\/+$/, '')}${path}`;
  }

  async languages(): Promise<LtLanguage[]> {
    const res = await fetch(this.url('/languages'), { signal: AbortSignal.timeout(this.timeoutMs) });
    if (!res.ok) throw new Error(`LibreTranslate /languages returned ${res.status}`);
    return (await res.json()) as LtLanguage[];
  }

  /** Translates several texts in one request. The result has the same length and order as `texts`. */
  async translate(texts: string[], source: string, target: string): Promise<string[]> {
    const res = await fetch(this.url('/translate'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: texts, source, target, format: 'text', ...(this.apiKey ? { api_key: this.apiKey } : {}) }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) {
      let detail = '';
      try { detail = ((await res.json()) as { error?: string }).error ?? ''; } catch { /* no JSON body */ }
      throw new Error(`LibreTranslate /translate returned ${res.status}${detail ? `: ${detail}` : ''}`);
    }
    const { translatedText } = (await res.json()) as { translatedText?: string | string[] };
    const out = Array.isArray(translatedText) ? translatedText : translatedText !== undefined ? [translatedText] : [];
    if (out.length !== texts.length) throw new Error('LibreTranslate returned an unexpected number of translations');
    return out;
  }
}

const BATCH_SIZE = 40;
const LANGUAGE_LIST_TTL_MS = 5 * 60_000;
const RETRY_AFTER_FAILURE_MS = 15_000;
const CACHE_LIMIT = 20_000;

function languageName(code: string, fallback?: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? fallback ?? code;
  } catch {
    return fallback ?? code;
  }
}

/**
 * Decides which text the browser sees for a chosen language. For every question field the order is:
 *   1. the original text, when the chosen language is the quiz's source language;
 *   2. the per-language column from the question file (e.g. question_sv), when filled in;
 *   3. a LibreTranslate translation (cached in memory);
 *   4. the original text, flagged as `incomplete`.
 * Answer keys are never touched: choices keep their letters, so scoring does not depend on the language.
 */
export class TranslationService {
  readonly sourceLanguage: string;
  private sourceLtCode: string;
  private readonly client?: LibreTranslateClient;
  private readonly questions: StoredQuestion[];
  private readonly fileLanguages: Set<string>;
  private readonly cache = new Map<string, string>();
  private readonly resolved = new Map<string, Promise<TranslatedQuestions>>();
  private machine: { at: number; langs: Map<string, MachineLanguage> } | null = null;
  private lastFailureAt = 0;

  constructor(options: { questions: StoredQuestion[]; sourceLanguage: string; client?: LibreTranslateClient }) {
    this.questions = options.questions;
    this.sourceLanguage = normalizeLanguage(options.sourceLanguage);
    this.sourceLtCode = this.sourceLanguage;
    this.client = options.client;
    this.fileLanguages = new Set(options.questions.flatMap((q) => Object.keys(q.translations)));
    this.fileLanguages.delete(this.sourceLanguage);
  }

  /** Languages LibreTranslate can produce from the source language. Empty when it is not configured or unreachable. */
  async machineLanguages(): Promise<Map<string, MachineLanguage>> {
    if (!this.client) return new Map();
    const now = Date.now();
    if (this.machine && now - this.machine.at < LANGUAGE_LIST_TTL_MS) return this.machine.langs;
    if (now - this.lastFailureAt < RETRY_AFTER_FAILURE_MS) return this.machine?.langs ?? new Map();
    try {
      const all = await this.client.languages();
      const source = all.find((l) => l.code.toLowerCase() === this.sourceLanguage);
      const langs = new Map<string, MachineLanguage>();
      if (source) {
        this.sourceLtCode = source.code;
        for (const target of source.targets ?? []) {
          const code = normalizeLanguage(target);
          if (code !== this.sourceLanguage) langs.set(code, { code, ltCode: target, name: all.find((l) => l.code === target)?.name ?? target });
        }
      } else {
        console.warn(`LibreTranslate does not offer the source language "${this.sourceLanguage}" (set QUIZ_LANGUAGE or load that model).`);
      }
      this.machine = { at: now, langs };
      return langs;
    } catch (e) {
      this.lastFailureAt = now;
      console.warn(`LibreTranslate is not reachable: ${(e as Error).message}`);
      return this.machine?.langs ?? new Map();
    }
  }

  async languages(): Promise<LanguageInfo[]> {
    const machine = await this.machineLanguages();
    const codes = new Set([this.sourceLanguage, ...this.fileLanguages, ...machine.keys()]);
    return [...codes]
      .map((code) => ({ code, name: languageName(code, machine.get(code)?.name), fromFiles: this.fileLanguages.has(code), machine: machine.has(code) }))
      .sort((a, b) => (a.code === this.sourceLanguage ? -1 : b.code === this.sourceLanguage ? 1 : a.name.localeCompare(b.name)));
  }

  private async assertSupported(lang: string) {
    if (lang === this.sourceLanguage || this.fileLanguages.has(lang)) return;
    if ((await this.machineLanguages()).has(lang)) return;
    throw new UnsupportedLanguageError(`Unsupported language "${lang}"`);
  }

  /** All questions in the chosen language (no answers, no explanations). */
  async translateQuestions(rawLang: string): Promise<TranslatedQuestions> {
    const lang = normalizeLanguage(rawLang);
    await this.assertSupported(lang);
    const existing = this.resolved.get(lang);
    if (existing) return existing;
    const promise = this.build(lang).then(
      (result) => { if (result.incomplete) this.resolved.delete(lang); return result; }, // retry later if LibreTranslate failed
      (error) => { this.resolved.delete(lang); throw error; },
    );
    this.resolved.set(lang, promise);
    return promise;
  }

  /** Explanation shown after an answer is submitted, in the chosen language. */
  async translateExplanation(question: StoredQuestion, rawLang: string): Promise<string | undefined> {
    const lang = normalizeLanguage(rawLang);
    await this.assertSupported(lang);
    if (lang === this.sourceLanguage || !question.explanation) return question.explanation;
    const fromFile = question.translations[lang]?.explanation;
    if (fromFile) return fromFile;
    const { translated } = await this.machineTranslate([question.explanation], lang);
    return translated.get(question.explanation) ?? question.explanation;
  }

  private async build(lang: string): Promise<TranslatedQuestions> {
    const pending: { text: string; apply: (translated: string) => void }[] = [];
    const questions = this.questions.map((q): PublicQuestion => {
      const tr = lang === this.sourceLanguage ? undefined : q.translations[lang];
      const pq: PublicQuestion = {
        id: q.id,
        text: tr?.text ?? q.text,
        category: tr?.category ?? q.category,
        choices: q.choices.map((c) => ({ id: c.id, text: tr?.choices?.[c.id] ?? c.text })),
      };
      if (lang === this.sourceLanguage) return pq;
      if (!tr?.text) pending.push({ text: q.text, apply: (t) => { pq.text = t; } });
      if (q.category && !tr?.category) pending.push({ text: q.category, apply: (t) => { pq.category = t; } });
      q.choices.forEach((c, i) => {
        if (!tr?.choices?.[c.id]) pending.push({ text: c.text, apply: (t) => { pq.choices[i].text = t; } });
      });
      return pq;
    });

    const { translated, failed } = await this.machineTranslate(pending.map((p) => p.text), lang);
    let machineTranslated = false;
    for (const p of pending) {
      const t = translated.get(p.text);
      if (t !== undefined) { p.apply(t); machineTranslated = true; }
    }
    return { language: lang, questions, machineTranslated, incomplete: failed };
  }

  /** Translates unique texts via LibreTranslate, using the cache first. `failed` is true if any text stayed untranslated. */
  private async machineTranslate(texts: string[], lang: string): Promise<{ translated: Map<string, string>; failed: boolean }> {
    const unique = [...new Set(texts)];
    const translated = new Map<string, string>();
    const todo: string[] = [];
    for (const text of unique) {
      const hit = this.cache.get(`${lang}\u0000${text}`);
      if (hit !== undefined) translated.set(text, hit);
      else todo.push(text);
    }
    const target = todo.length > 0 ? (await this.machineLanguages()).get(lang) : undefined;
    if (this.client && target) {
      for (let i = 0; i < todo.length; i += BATCH_SIZE) {
        const chunk = todo.slice(i, i + BATCH_SIZE);
        try {
          const out = await this.client.translate(chunk, this.sourceLtCode, target.ltCode);
          chunk.forEach((text, j) => {
            if (out[j]?.trim()) {
              if (this.cache.size >= CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value as string);
              this.cache.set(`${lang}\u0000${text}`, out[j]);
              translated.set(text, out[j]);
            }
          });
        } catch (e) {
          console.warn(`Translation to "${lang}" failed: ${(e as Error).message}`);
          break;
        }
      }
    }
    return { translated, failed: unique.some((t) => !translated.has(t)) };
  }
}
