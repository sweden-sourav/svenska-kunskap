import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { PublicQuestion, Submitted } from '../types';

interface Props {
  question: PublicQuestion;
  number: number;
  total: number;
  submitted?: Submitted;
  onSubmit: (choiceId: string) => Promise<void>;
  onNext: () => void;
}

export function QuestionCard({ question, number, total, submitted, onSubmit, onNext }: Props) {
  const [selected, setSelected] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const headingRef = useRef<HTMLLegendElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

  // Keyboard and screen-reader users: land on the new question, then on "Next" once feedback appears.
  useEffect(() => { if (number > 1) headingRef.current?.focus(); }, [number]);
  useEffect(() => { if (submitted) nextRef.current?.focus(); }, [submitted]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!selected || pending || submitted) return;
    setPending(true);
    setError('');
    try {
      await onSubmit(selected);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  const answered = submitted !== undefined;
  const correctChoice = question.choices.find((c) => c.id === submitted?.result.correctChoiceId);

  return (
    <form className="card" onSubmit={handleSubmit} aria-labelledby="q-text">
      <fieldset>
        <legend ref={headingRef} tabIndex={-1}>
          {question.category && <span className="category">{question.category}</span>}
          <span id="q-text" className="q-text">{question.text}</span>
        </legend>

        <div className="choices">
          {question.choices.map((c) => {
            const isMine = submitted?.choiceId === c.id;
            const isRight = submitted?.result.correctChoiceId === c.id;
            const state = !answered ? '' : isRight ? 'right' : isMine ? 'wrong' : '';
            return (
              <label key={c.id} className={`choice ${state} ${selected === c.id ? 'selected' : ''}`}>
                <input
                  type="radio"
                  name={`q-${question.id}`}
                  value={c.id}
                  checked={(answered ? submitted.choiceId : selected) === c.id}
                  disabled={answered}
                  onChange={() => setSelected(c.id)}
                />
                <span className="key" aria-hidden="true">{c.id}</span>
                <span className="choice-text">{c.text}</span>
                {answered && isRight && <span className="tag">Correct answer</span>}
                {answered && isMine && !isRight && <span className="tag">Your answer</span>}
              </label>
            );
          })}
        </div>
      </fieldset>

      <div role="status" aria-live="polite" className="feedback-slot">
        {submitted && (
          <div className={`feedback ${submitted.result.correct ? 'ok' : 'bad'}`}>
            <p className="verdict">{submitted.result.correct ? 'Correct' : 'Incorrect'}</p>
            {!submitted.result.correct && correctChoice && (
              <p>The correct answer is {correctChoice.id}: {correctChoice.text}</p>
            )}
            {submitted.result.explanation && <p>{submitted.result.explanation}</p>}
          </div>
        )}
        {error && <p className="error">{error}</p>}
      </div>

      <div className="actions">
        {answered ? (
          <button type="button" className="primary" ref={nextRef} onClick={onNext}>
            {number === total ? 'See results' : 'Next question'}
          </button>
        ) : (
          <button type="submit" className="primary" disabled={!selected || pending}>
            {pending ? 'Checking…' : 'Check answer'}
          </button>
        )}
      </div>
    </form>
  );
}
