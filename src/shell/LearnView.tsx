import { useState } from 'react';
import { QUIZ_QUESTIONS, explanationFor } from '../content/quiz';
import { GLOSSARY } from '../explain/glossary';
import { recordQuizResult, readProgress } from '../progress/progress-store';
import { FindDriverView, PredictView } from './PlayView';

type Phase = 'intro' | 'asking' | 'done';

/**
 * Learn: a scored quiz plus the glossary it is drawn from.
 *
 * Wrong answers immediately show the explanation rather than only a score at
 * the end — the goal is teaching, and a score you cannot learn from is just a
 * judgement.
 */
export function LearnView() {
  const [phase, setPhase] = useState<Phase>('intro');
  const [index, setIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [best, setBest] = useState(() => readProgress().bestQuizScore);

  const question = QUIZ_QUESTIONS[index];
  const total = QUIZ_QUESTIONS.length;

  const start = () => {
    setPhase('asking');
    setIndex(0);
    setScore(0);
    setPicked(null);
  };

  const choose = (option: number) => {
    if (picked !== null) return;
    setPicked(option);
    if (option === question.answer) setScore((value) => value + 1);
  };

  const next = () => {
    if (index + 1 >= total) {
      const finalScore = score;
      setBest(recordQuizResult(finalScore).bestQuizScore);
      setPhase('done');
      return;
    }
    setIndex((value) => value + 1);
    setPicked(null);
  };

  return (
    <div className="shell-view">
      <header className="shell-head">
        <h1>Learn</h1>
        <p>
          The two things that most often lose a new viewer are tyre strategy and DRS. Answer eight
          questions and find out where you stand — every wrong answer explains itself.
        </p>
      </header>

      <section className="panel quiz" aria-label="Formula 1 quiz">
        {phase === 'intro' && (
          <>
            <h2>Quick quiz · {total} questions</h2>
            <p className="quiz__lede">No signup. Your best score is remembered on this device only.</p>
            {best > 0 && <p className="quiz__best">Best so far: <strong>{best}/{total}</strong></p>}
            <button type="button" className="shell-btn shell-btn--primary" onClick={start}>Start the quiz</button>
          </>
        )}

        {phase === 'asking' && (
          <>
            <p className="quiz__progress">Question {index + 1} of {total}</p>
            <h2>{question.prompt}</h2>
            <ul className="quiz__options">
              {question.options.map((option, optionIndex) => {
                const isAnswer = optionIndex === question.answer;
                const isPicked = picked === optionIndex;
                const state = picked === null ? '' : isAnswer ? ' is-correct' : isPicked ? ' is-wrong' : '';
                return (
                  <li key={option}>
                    <button
                      type="button"
                      className={`quiz__option${state}`}
                      disabled={picked !== null}
                      aria-pressed={isPicked}
                      onClick={() => choose(optionIndex)}
                    >
                      {option}
                    </button>
                  </li>
                );
              })}
            </ul>
            {picked !== null && (
              <div className="quiz__feedback" role="status">
                <p className={picked === question.answer ? 'is-correct' : 'is-wrong'}>
                  {picked === question.answer ? 'Correct.' : 'Not quite.'}
                </p>
                {explanationFor(question) && <p>{explanationFor(question)}</p>}
                <button type="button" className="shell-btn shell-btn--primary" onClick={next}>
                  {index + 1 >= total ? 'See my score' : 'Next question'}
                </button>
              </div>
            )}
          </>
        )}

        {phase === 'done' && (
          <>
            <h2>You scored {score} of {total}</h2>
            <p className="quiz__lede">
              {score === total
                ? 'Full marks. You can safely turn Explain Mode off.'
                : score >= total / 2
                  ? 'A solid base. Watch a race with Explain Mode on and the rest will click.'
                  : 'Plenty to pick up — Explain Mode annotates a live race as it happens.'}
            </p>
            <p className="quiz__best">Best so far: <strong>{best}/{total}</strong></p>
            <div className="shell-actions">
              <button type="button" className="shell-btn" onClick={start}>Try again</button>
              <a className="shell-btn shell-btn--primary" href="#/race">Watch a race</a>
            </div>
          </>
        )}
      </section>

      <PredictView />
      <FindDriverView />

      <section className="panel" aria-label="Glossary">
        <h2>Glossary</h2>
        <dl className="glossary">
          {GLOSSARY.map((entry) => (
            <div key={entry.term}>
              <dt>{entry.term}</dt>
              <dd>{entry.long}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
