import { useMemo, useState } from 'react';
import {
  MATCH_QUESTIONS, MAX_PREDICTION_SCORE, dailySeed, matchDriver, scorePrediction,
  type MatchOption,
} from '../content/match';
import { findProfile } from '../content/driver-profiles';
import { DEFAULT_RACE_CONFIG } from '../domain/race-config';
import { DRIVERS_2026, TEAMS_2026 } from '../domain/grid-2026';
import { createRaceEngine } from '../simulation/race-engine';
import { SHANGHAI_TRACK } from '../track/shanghai-track';
import { readProgress, recordMatchedDriver, recordPrediction } from '../progress/progress-store';

function teamOf(teamId: string) {
  return TEAMS_2026.find((team) => team.id === teamId) ?? TEAMS_2026[0];
}

function driverName(driverId: string) {
  return DRIVERS_2026.find((driver) => driver.id === driverId)?.name ?? driverId;
}

/**
 * Runs the day's seed to completion and returns the podium.
 *
 * The engine is deterministic, so the same seed always produces the same
 * result — which is what makes a prediction meaningful rather than a coin toss.
 * This only reads the simulation; it does not change it.
 */
function podiumForSeed(seed: string): string[] {
  const engine = createRaceEngine({ ...DEFAULT_RACE_CONFIG, seed }, SHANGHAI_TRACK, DRIVERS_2026);
  engine.runToFinish();
  return engine.snapshot().cars
    .filter((car) => car.status === 'finished')
    .sort((a, b) => (a.finishPosition ?? 99) - (b.finishPosition ?? 99))
    .slice(0, 3)
    .map((car) => car.driverId);
}

/* ------------------------------------------------------ predict the podium -- */

export function PredictView() {
  const seed = useMemo(() => dailySeed(), []);
  const [picks, setPicks] = useState<string[]>([]);
  const [result, setResult] = useState<{ podium: string[]; score: number } | null>(null);
  const [progress, setProgress] = useState(() => readProgress());
  const [busy, setBusy] = useState(false);

  const toggle = (driverId: string) => {
    if (result) return;
    setPicks((current) => (current.includes(driverId)
      ? current.filter((id) => id !== driverId)
      : current.length < 3 ? [...current, driverId] : current));
  };

  const reveal = () => {
    setBusy(true);
    // Deliberately synchronous: a full race resolves in well under a second.
    const podium = podiumForSeed(seed);
    const score = scorePrediction(picks, podium);
    setResult({ podium, score });
    setProgress(recordPrediction({ seed, picks, score }));
    setBusy(false);
  };

  return (
    <section className="panel" aria-label="Predict the podium">
      <h2>Predict the podium</h2>
      <p className="quiz__lede">
        Pick three drivers in finishing order for today&rsquo;s race, then watch it resolve. The
        simulation is deterministic, so today&rsquo;s seed always produces the same result — your call
        is against a real outcome, not a coin toss.
      </p>
      <p className="quiz__best">
        Streak: <strong>{progress.predictionStreak}</strong> · Best: <strong>{progress.bestPredictionScore}/{MAX_PREDICTION_SCORE}</strong>
      </p>

      <ol className="predict-slots" aria-label="Your podium">
        {[0, 1, 2].map((slot) => (
          <li key={slot}>
            <span className="predict-slots__pos">P{slot + 1}</span>
            <span className="predict-slots__name">{picks[slot] ? driverName(picks[slot]) : 'Not picked'}</span>
          </li>
        ))}
      </ol>

      <div className="predict-grid" role="group" aria-label="Choose drivers">
        {DRIVERS_2026.map((driver) => {
          const order = picks.indexOf(driver.id);
          const chosen = order >= 0;
          return (
            <button
              key={driver.id}
              type="button"
              className={chosen ? 'predict-pick is-chosen' : 'predict-pick'}
              style={{ '--team': teamOf(driver.teamId).color } as React.CSSProperties}
              aria-pressed={chosen}
              disabled={Boolean(result)}
              onClick={() => toggle(driver.id)}
            >
              <span className="predict-pick__abbr">{driver.abbreviation}</span>
              {chosen && <span className="predict-pick__order">P{order + 1}</span>}
            </button>
          );
        })}
      </div>

      {!result && (
        <div className="shell-actions">
          <button
            type="button"
            className="shell-btn shell-btn--primary"
            disabled={picks.length < 3 || busy}
            onClick={reveal}
          >
            {picks.length < 3 ? `Pick ${3 - picks.length} more` : 'Run the race'}
          </button>
          {picks.length > 0 && (
            <button type="button" className="shell-btn" onClick={() => setPicks([])}>Clear</button>
          )}
        </div>
      )}

      {result && (
        <div className="quiz__feedback" role="status">
          <p className={result.score > 0 ? 'is-correct' : 'is-wrong'}>
            You scored {result.score} of {MAX_PREDICTION_SCORE}.
          </p>
          <ol className="predict-slots" aria-label="Actual podium">
            {result.podium.map((driverId, index) => (
              <li key={driverId}>
                <span className="predict-slots__pos">P{index + 1}</span>
                <span className="predict-slots__name">{driverName(driverId)}</span>
              </li>
            ))}
          </ol>
          <div className="shell-actions">
            <a className="shell-btn shell-btn--primary" href="#/race">Watch it happen</a>
            <button
              type="button"
              className="shell-btn"
              onClick={() => { setResult(null); setPicks([]); }}
            >
              Predict again
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/* ---------------------------------------------------------- find my driver -- */

export function FindDriverView() {
  const [answers, setAnswers] = useState<MatchOption[]>([]);
  const [progress, setProgress] = useState(() => readProgress());

  const index = answers.length;
  const question = MATCH_QUESTIONS[index];
  const match = index >= MATCH_QUESTIONS.length ? matchDriver(answers) : null;

  const choose = (option: MatchOption) => {
    const next = [...answers, option];
    setAnswers(next);
    if (next.length === MATCH_QUESTIONS.length) {
      const outcome = matchDriver(next);
      if (outcome) setProgress(recordMatchedDriver(outcome.driverId));
    }
  };

  const matched = match ? DRIVERS_2026.find((driver) => driver.id === match.driverId) : undefined;
  const profile = matched ? findProfile(matched.id) : undefined;

  return (
    <section className="panel" aria-label="Find my driver">
      <h2>Find my driver</h2>
      <p className="quiz__lede">
        Six questions. Matching runs against the same ratings the simulation races with, so the
        driver you get genuinely behaves the way you answered.
      </p>
      {progress.matchedDriverId && !match && (
        <p className="quiz__best">Last time you matched <strong>{driverName(progress.matchedDriverId)}</strong>.</p>
      )}

      {question && (
        <>
          <p className="quiz__progress">Question {index + 1} of {MATCH_QUESTIONS.length}</p>
          <h3>{question.prompt}</h3>
          <ul className="quiz__options">
            {question.options.map((option) => (
              <li key={option.id}>
                <button type="button" className="quiz__option" onClick={() => choose(option)}>
                  {option.label}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {matched && (
        <div className="quiz__feedback" role="status">
          <p className="is-correct">Your driver is {matched.name}.</p>
          <div className="driver-card" style={{ '--team': teamOf(matched.teamId).color } as React.CSSProperties}>
            <div className="driver-card__head">
              <span className="driver-card__number">{matched.number}</span>
              <div>
                <h3>{matched.name}</h3>
                <p className="driver-card__team">{teamOf(matched.teamId).name} · {matched.nationality}</p>
              </div>
            </div>
            {profile && <p className="driver-card__hook">{profile.hook}</p>}
          </div>
          <div className="shell-actions">
            <a className="shell-btn shell-btn--primary" href="#/race">Watch them race</a>
            <button type="button" className="shell-btn" onClick={() => setAnswers([])}>Start over</button>
          </div>
        </div>
      )}
    </section>
  );
}
