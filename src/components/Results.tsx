import type { PublicQuestion, Submitted } from "../types";

interface Props {
  questions: PublicQuestion[];
  answers: Record<string, Submitted>;
  onRestart: () => void;
}

export function Results({ questions, answers, onRestart }: Props) {
  const correct = questions.filter((q) => answers[q.id]?.result.correct).length;
  return (
    <section className="card results" aria-labelledby="results-title">
      <h2 id="results-title" tabIndex={-1} ref={(el) => el?.focus()}>
        You answered {correct} of {questions.length} correctly
      </h2>
      <ol id="results-summary" className="review">
        {questions.map((q) => {
          const a = answers[q.id];
          const mine = q.choices.find((c) => c.id === a?.choiceId);
          const right = q.choices.find(
            (c) => c.id === a?.result.correctChoiceId,
          );
          return (
            <li key={q.id} className={a?.result.correct ? "ok" : "bad"}>
              <p className="review-q">{q.text}</p>
              <p>
                <strong>{a?.result.correct ? "Correct" : "Incorrect"}.</strong>{" "}
                {a?.result.correct
                  ? `${mine?.id}: ${mine?.text}`
                  : `You chose ${mine?.id}: ${mine?.text}. Correct: ${right?.id}: ${right?.text}`}
              </p>
            </li>
          );
        })}
      </ol>
      <div className="actions">
        <button type="button" className="primary" onClick={onRestart}>
          Restart quiz
        </button>
      </div>
    </section>
  );
}
