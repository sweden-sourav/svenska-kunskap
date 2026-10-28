import { useState } from "react";
import type { PublicQuestion, Submitted } from "../types";

interface Props {
  questions: PublicQuestion[];
  answers: Record<string, Submitted>;
  title?: string;
}

/** Always-visible answer summary while the quiz is in progress. */
export function SummaryPanel({
  questions,
  answers,
  title = "Answer summary",
}: Props) {
  const [showCompact, setShowCompact] = useState(true);
  const [showDetailed, setShowDetailed] = useState(false);

  return (
    <section className="card summary-panel" aria-labelledby="summary-title">
      <h2 id="summary-title">{title}</h2>
      <div className="summary-sections">
        <div className="summary-block">
          <button
            type="button"
            className="secondary summary-toggle"
            aria-expanded={showCompact}
            aria-controls="summary-compact"
            onClick={() => setShowCompact((v) => !v)}
          >
            {showCompact ? "Hide quick status" : "Show quick status"}
          </button>
          {showCompact && (
            <ol
              id="summary-compact"
              className="summary-status-list"
              aria-label="Question status list"
            >
              {questions.map((q, i) => {
                const a = answers[q.id];
                const state = !a ? "pending" : a.result.correct ? "ok" : "bad";
                const label = !a
                  ? "Not answered"
                  : a.result.correct
                    ? "Correct"
                    : "Incorrect";
                return (
                  <li key={q.id} className={`summary-status ${state}`}>
                    <span className="summary-status-q">Q{i + 1}</span>
                    <span className="summary-status-label">{label}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        <div className="summary-block">
          <button
            type="button"
            className="secondary summary-toggle"
            aria-expanded={showDetailed}
            aria-controls="summary-detailed"
            onClick={() => setShowDetailed((v) => !v)}
          >
            {showDetailed ? "Hide detailed summary" : "Show detailed summary"}
          </button>
          {showDetailed && (
            <ol id="summary-detailed" className="review summary-list">
              {questions.map((q, i) => {
                const a = answers[q.id];
                const mine = q.choices.find((c) => c.id === a?.choiceId);
                const right = q.choices.find(
                  (c) => c.id === a?.result.correctChoiceId,
                );
                const state = !a ? "pending" : a.result.correct ? "ok" : "bad";

                return (
                  <li key={q.id} className={state}>
                    <p className="review-q">
                      {i + 1}. {q.text}
                    </p>
                    {!a && (
                      <p>
                        <strong>Not answered yet.</strong>
                      </p>
                    )}
                    {a?.result.correct && (
                      <p>
                        <strong>Correct.</strong> {mine?.id}: {mine?.text}
                      </p>
                    )}
                    {a && !a.result.correct && (
                      <p>
                        <strong>Incorrect.</strong> You chose {mine?.id}:{" "}
                        {mine?.text}. Correct: {right?.id}: {right?.text}
                      </p>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>
    </section>
  );
}
