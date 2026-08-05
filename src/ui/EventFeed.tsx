import { useEffect, useRef, useState } from 'react';
import type { ImmutableRaceEvent } from '../store/race-store';
import { formatRaceEvent } from './formatters';

export function eventKey(event: ImmutableRaceEvent): string {
  switch (event.type) {
    case 'sector': return `${event.tick}:${event.type}:${event.driverId}:${event.lap}:${event.sector}`;
    case 'lap': return `${event.tick}:${event.type}:${event.driverId}:${event.lap}`;
    case 'overtake': return `${event.tick}:${event.type}:${event.attackerId}:${event.defenderId}:${event.position}`;
    case 'incident': return `${event.tick}:${event.type}:${event.driverIds.join('-')}:${event.severity}`;
    case 'flag': return `${event.tick}:${event.type}:${event.flag}`;
    case 'weather': return `${event.tick}:${event.type}:${event.weather}`;
    case 'tire-change': return `${event.tick}:${event.type}:${event.driverId}:${event.compound}`;
    case 'finish': return `${event.tick}:${event.type}:${event.driverId}:${event.position}`;
    case 'retirement': return `${event.tick}:${event.type}:${event.driverId}:${event.reason}`;
    case 'pit-entry': case 'pit-exit': return `${event.tick}:${event.type}:${event.driverId}`;
    case 'start': return `${event.tick}:${event.type}`;
  }
}

function eventClock(tick: number): string {
  return `T+${(tick * 0.1).toFixed(1)}s`;
}

export function EventFeed({ events }: { events: readonly ImmutableRaceEvent[] }) {
  const recent = events.slice(-5).reverse();
  const latest = events.at(-1);
  const [announcement, setAnnouncement] = useState(() => latest ? formatRaceEvent(latest) : 'Awaiting race start');
  const lastAnnouncedTick = useRef(latest?.tick ?? Number.NEGATIVE_INFINITY);
  useEffect(() => {
    if (!latest || latest.tick <= lastAnnouncedTick.current) return;
    const urgent = ['incident', 'retirement', 'flag', 'weather', 'finish'].includes(latest.type);
    if (!urgent && latest.tick - lastAnnouncedTick.current < 30) return;
    lastAnnouncedTick.current = latest.tick;
    setAnnouncement(formatRaceEvent(latest));
  }, [latest]);
  return (
    <section className="event-feed" role="log" aria-label="Race events" aria-live="off">
      <header className="panel-kicker"><span>Race control</span><span aria-hidden="true">● LIVE</span></header>
      {recent.length ? (
        <ol>{recent.map((event) => <li key={eventKey(event)}><time>{eventClock(event.tick)}</time><span>{formatRaceEvent(event)}</span></li>)}</ol>
      ) : <p className="event-feed__empty">Awaiting race start</p>}
      <p className="visually-hidden" role="region" aria-label="Latest race announcement" aria-live="polite" aria-atomic="true">{announcement}</p>
    </section>
  );
}
