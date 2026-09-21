import { routeHref, type RouteName } from './router';

const LINKS: { name: RouteName; label: string }[] = [
  { name: 'home', label: 'Home' },
  { name: 'circuits', label: 'Circuits' },
  { name: 'garage', label: 'Garage' },
  { name: 'drivers', label: 'Drivers' },
  { name: 'learn', label: 'Learn' },
];

export function AppNav({ active }: { active: RouteName }) {
  // The circuit detail page lives under Circuits, so keep that tab lit.
  const current = active === 'circuit' ? 'circuits' : active === 'play-race' ? 'play' : active;

  return (
    <header className="shell-nav">
      <a className="shell-nav__brand" href={routeHref('home')}>
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
      </nav>
      <a className="shell-nav__cta" href={routeHref('play')}>Choose race</a>
    </header>
  );
}
