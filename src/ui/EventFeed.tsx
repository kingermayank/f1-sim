import type { ImmutableRaceEvent } from '../store/race-store';
import { formatRaceEvent } from './formatters';

export function EventFeed({ events }: { events: readonly ImmutableRaceEvent[] }) {
  const recent = events.slice(-5).reverse();
  return (
    <section className="event-feed" role="log" aria-label="Race events" aria-live="polite" aria-relevant="additions text">
      <header className="panel-kicker"><span>Race control</span><span aria-hidden="true">● LIVE</span></header>
      {recent.length ? (
        <ol>{recent.map((event, index) => <li key={`${event.tick}-${event.type}-${index}`}><time>T+{event.tick}</time><span>{formatRaceEvent(event)}</span></li>)}</ol>
      ) : <p className="event-feed__empty">Awaiting race start</p>}
    </section>
  );
}
