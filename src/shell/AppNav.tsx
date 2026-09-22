import { useState } from 'react';
import { routeHref, type RouteName } from './router';
import { isUiSoundEnabled, setUiSoundEnabled } from './ui-sound';

const LINKS: { name: RouteName; label: string }[] = [
  { name: 'circuits', label: 'Circuits' },
  { name: 'garage', label: 'Garage' },
  { name: 'drivers', label: 'Drivers' },
  { name: 'learn', label: 'Learn' },
];

/**
 * The one top bar, on every page: the brand, the browse links with the
 * current one lit, the broadcast simulation, and Race. On the homepage —
 * which is the race menu — Race scrolls to the Start button instead of
 * navigating away from it.
 */
export function AppNav({ active }: { active: RouteName }) {
  // Detail pages light their section's tab.
  const current: RouteName = active === 'circuit' ? 'circuits' : active === 'play-race' ? 'play' : active;
  const onHome = current === 'home' || current === 'play';
  const [sound, setSound] = useState(() => (typeof window === 'undefined' ? true : isUiSoundEnabled()));
  const toggleSound = () => {
    const next = !sound;
    setSound(next);
    setUiSoundEnabled(next);
  };

  const race = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (!onHome) return;
    event.preventDefault();
    const start = document.querySelector<HTMLElement>('.showroom__start');
    start?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    start?.focus({ preventScroll: true });
  };

  return (
    <header className={onHome ? 'shell-nav shell-nav--home' : 'shell-nav'}>
      <a className="shell-nav__brand" href={routeHref('home')} aria-label="APEX home">
        <span className="shell-nav__mark" aria-hidden="true">A</span>
        <span className="shell-nav__wordmark">APEX</span>
      </a>
      <nav aria-label="Primary">
        {LINKS.map((link) => (
          <a
            key={link.name}
            href={routeHref(link.name)}
            className={current === link.name ? 'is-active' : undefined}
            aria-current={current === link.name ? 'page' : undefined}
          >
            {link.label}
          </a>
        ))}
        <a href={routeHref('race')} className="shell-nav__watch">Watch the simulation</a>
      </nav>
      <button
        type="button"
        className="shell-nav__sound"
        onClick={toggleSound}
        aria-pressed={sound}
        aria-label={sound ? 'Menu sounds on' : 'Menu sounds off'}
        title={sound ? 'Menu sounds on' : 'Menu sounds off'}
      >
        ♪
      </button>
      <a className="shell-nav__cta" href={routeHref('home')} onClick={race}>Race →</a>
    </header>
  );
}
