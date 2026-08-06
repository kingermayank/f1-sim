import { useEffect, useState } from 'react';
import { useRaceStore } from '../store/race-store';
import { explainFeed } from './explain';
import { AnnotatedText } from './Jargon';

/**
 * On a small screen there is no room for a persistent panel beside the race —
 * it would sit on top of the timing tower and swallow taps meant for it. There
 * the panel stays collapsed until the viewer asks for it, while the saved
 * preference still governs the desktop layout.
 */
function useNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const query = window.matchMedia('(max-width: 860px)');
    const sync = () => setNarrow(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);
  return narrow;
}

/**
 * The annotated race feed. Every entry states what happened and, underneath,
 * why — with jargon tooltipped inline.
 *
 * It is a toggle because the audience is split: a newcomer needs the reasons,
 * and someone who already knows the sport should not be patronised by them.
 */
export function ExplainPanel() {
  const snapshot = useRaceStore((state) => state.snapshot);
  const explainEnabled = useRaceStore((state) => state.explainEnabled);
  const setExplainEnabled = useRaceStore((state) => state.setExplainEnabled);
  const narrow = useNarrowViewport();
  const [openOnNarrow, setOpenOnNarrow] = useState(false);

  const expanded = explainEnabled && (!narrow || openOnNarrow);

  if (!expanded) {
    return (
      <button
        type="button"
        className="explain-toggle"
        aria-pressed={false}
        onClick={() => {
          setExplainEnabled(true);
          if (narrow) setOpenOnNarrow(true);
        }}
      >
        Explain mode
      </button>
    );
  }

  const feed = explainFeed(snapshot);

  return (
    <section className="explain-panel" aria-label="Explain mode">
      <header className="explain-panel__head">
        <h2>Why that happened</h2>
        <button
          type="button"
          className="explain-panel__off"
          aria-pressed
          onClick={() => {
            if (narrow) setOpenOnNarrow(false);
            else setExplainEnabled(false);
          }}
        >
          Turn off
        </button>
      </header>

      {feed.length === 0 ? (
        <p className="explain-panel__empty">
          Nothing to explain yet — the first calls of the race will appear here as they happen.
        </p>
      ) : (
        <ol className="explain-panel__feed">
          {feed.map(({ event, explanation }, index) => (
            <li key={`${event.type}-${event.tick}-${index}`}>
              <p className="explain-panel__what">{explanation.headline}</p>
              <p className="explain-panel__why">
                <AnnotatedText text={explanation.reason} terms={explanation.terms} />
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
