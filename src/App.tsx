import { useCallback, useEffect, useState } from "react";
import { getLanguages, getQuestions, getStatus, submitAnswer } from "./api";
import { BankIssues } from "./components/BankIssues";
import { LanguageSelect } from "./components/LanguageSelect";
import { QuestionCard } from "./components/QuestionCard";
import { Results } from "./components/Results";
import { SummaryPanel } from "./components/SummaryPanel";
import type {
  BankStatus,
  LanguagesResponse,
  PublicQuestion,
  QuestionsResponse,
  Submitted,
} from "./types";

const LANG_KEY = "quiz-language";
const readSavedLang = () => {
  try {
    return localStorage.getItem(LANG_KEY) ?? "";
  } catch {
    return "";
  }
};
const saveLang = (code: string) => {
  try {
    localStorage.setItem(LANG_KEY, code);
  } catch {
    /* storage unavailable */
  }
};

type Load =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; questions: PublicQuestion[]; status: BankStatus };

export default function App() {
  const [load, setLoad] = useState<Load>({ phase: "loading" });
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, Submitted>>({});
  const [finished, setFinished] = useState(false);
  const [languages, setLanguages] = useState<LanguagesResponse | null>(null);
  const [lang, setLang] = useState("");
  const [translation, setTranslation] = useState({
    machineTranslated: false,
    incomplete: false,
  });
  const [switching, setSwitching] = useState(false);
  const [langError, setLangError] = useState("");

  const applyLanguage = (r: QuestionsResponse) => {
    setLang(r.language);
    setTranslation({
      machineTranslated: r.machineTranslated,
      incomplete: r.incomplete,
    });
  };

  const loadBank = useCallback(async () => {
    setLoad({ phase: "loading" });
    try {
      const langs = await getLanguages();
      const saved = readSavedLang();
      const wanted = langs.languages.some((l) => l.code === saved)
        ? saved
        : langs.sourceLanguage;
      const [q, status] = await Promise.all([
        getQuestions(wanted),
        getStatus(),
      ]);
      setLanguages(langs);
      applyLanguage(q);
      setLoad({ phase: "ready", questions: q.questions, status });
    } catch (err) {
      setLoad({ phase: "error", message: (err as Error).message });
    }
  }, []);

  useEffect(() => {
    void loadBank();
  }, [loadBank]);

  const restart = () => {
    setIndex(0);
    setAnswers({});
    setFinished(false);
  };

  /** Switches the language without losing progress: question ids are the same in every language. */
  async function changeLanguage(code: string) {
    if (code === lang) return;
    setSwitching(true);
    setLangError("");
    try {
      const q = await getQuestions(code);
      // Explanations of already answered questions must follow the new language (re-checking is harmless).
      const refreshed = await Promise.all(
        Object.entries(answers).map(
          async ([id, a]) =>
            [
              id,
              {
                choiceId: a.choiceId,
                result: await submitAnswer(id, a.choiceId, code),
              },
            ] as const,
        ),
      );
      setAnswers(Object.fromEntries(refreshed));
      setLoad((prev) =>
        prev.phase === "ready" ? { ...prev, questions: q.questions } : prev,
      );
      applyLanguage(q);
      saveLang(code);
    } catch (err) {
      setLangError(`Could not switch language: ${(err as Error).message}`);
    } finally {
      setSwitching(false);
    }
  }

  let body;
  if (load.phase === "loading") {
    body = (
      <p className="notice" role="status">
        Loading questions…
      </p>
    );
  } else if (load.phase === "error") {
    body = (
      <div className="notice" role="alert">
        <h2>The quiz could not start</h2>
        <p>{load.message}</p>
        <button
          type="button"
          className="primary"
          onClick={() => void loadBank()}
        >
          Try again
        </button>
      </div>
    );
  } else if (load.questions.length === 0) {
    body = (
      <div className="notice" role="alert">
        <h2>No questions available</h2>
        <p>
          The server did not find any valid questions. Add question files to{" "}
          <code>data/questions/</code>, fix the problems listed below, then
          restart the server.
        </p>
        <BankIssues issues={load.status.issues} open />
        <button
          type="button"
          className="primary"
          onClick={() => void loadBank()}
        >
          Check again
        </button>
      </div>
    );
  } else if (finished) {
    body = (
      <Results
        questions={load.questions}
        answers={answers}
        onRestart={restart}
      />
    );
  } else {
    const { questions, status } = load;
    const q = questions[index];
    const answeredCount = Object.keys(answers).length;
    const correctCount = Object.values(answers).filter(
      (a) => a.result.correct,
    ).length;
    body = (
      <>
        <div className="progress">
          <p>
            <span>
              Question {index + 1} of {questions.length}
            </span>
            <span className="score">{correctCount} correct so far</span>
          </p>
          <div
            className="bar"
            role="progressbar"
            aria-label="Quiz progress"
            aria-valuemin={0}
            aria-valuemax={questions.length}
            aria-valuenow={answeredCount}
            aria-valuetext={`${answeredCount} of ${questions.length} answered`}
          >
            <div
              style={{ width: `${(answeredCount / questions.length) * 100}%` }}
            />
          </div>
        </div>
        {translation.machineTranslated && (
          <p className="note" role="status">
            Machine translated with LibreTranslate. Wording may be inexact; the
            original is the reference.
          </p>
        )}
        {translation.incomplete && (
          <p className="note" role="status">
            Some text could not be translated and is shown in the original
            language.
          </p>
        )}
        {langError && (
          <p className="note error" role="alert">
            {langError}
          </p>
        )}
        <QuestionCard
          key={q.id}
          question={q}
          number={index + 1}
          total={questions.length}
          submitted={answers[q.id]}
          onSubmit={async (choiceId) => {
            const result = await submitAnswer(q.id, choiceId, lang);
            setAnswers((prev) => ({ ...prev, [q.id]: { choiceId, result } }));
          }}
          onNext={() =>
            index + 1 < questions.length
              ? setIndex(index + 1)
              : setFinished(true)
          }
        />
        <SummaryPanel questions={questions} answers={answers} />
        {status.issues.some((i) => i.severity === "error") && (
          <BankIssues issues={status.issues} />
        )}
      </>
    );
  }

  return (
    <div className="shell">
      <header>
        <h1>Quiz</h1>
        {load.phase === "ready" && load.questions.length > 0 && (
          <div className="tools">
            {languages && (
              <LanguageSelect
                languages={languages.languages}
                value={lang}
                disabled={switching}
                onChange={(c) => void changeLanguage(c)}
              />
            )}
            <button type="button" className="secondary" onClick={restart}>
              Restart quiz
            </button>
          </div>
        )}
      </header>
      <main lang={lang || undefined} aria-busy={switching}>
        {body}
      </main>
    </div>
  );
}
