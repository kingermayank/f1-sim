import { useEffect, useId, useRef, useState } from 'react';
import f1Logo from '../assets/f1-logo.svg';
import { routeHref, type RouteName } from './router';
import { isUiSoundEnabled, setUiSoundEnabled, uiSound } from './ui-sound';

const LINKS: { name: RouteName; label: string }[] = [
  { name: 'circuits', label: 'Circuits' },
  { name: 'garage', label: 'Garage' },
  { name: 'drivers', label: 'Drivers' },
];

/**
 * The one top bar, on every page: the brand, the browse links with the
 * current one lit, the broadcast simulation, and the sound toggle.
 */
export function AppNav({ active }: { active: RouteName }) {
  // Detail pages light their section's tab.
  const current: RouteName = active === 'circuit' ? 'circuits' : active === 'play-race' ? 'play' : active;
  const onHome = current === 'home' || current === 'play';
  const [sound, setSound] = useState(() => (typeof window === 'undefined' ? true : isUiSoundEnabled()));
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();
  const headerRef = useRef<HTMLElement>(null);
  const toggleSound = () => {
    const next = !sound;
    setSound(next);
    setUiSoundEnabled(next);
  };
  const toggleMenu = () => {
    uiSound.click(menuOpen ? 0.35 : 0.55);
    setMenuOpen((open) => !open);
  };

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    const onPointer = (event: PointerEvent) => {
      if (!headerRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer);
    };
  }, [menuOpen]);

  return (
    <header ref={headerRef} className={onHome ? 'shell-nav shell-nav--home' : 'shell-nav'}>
      <a className="shell-nav__brand" href={routeHref('home')} aria-label="APEX home">
        <span className="shell-nav__mark" aria-hidden="true"><img src={f1Logo} alt="" /></span>
        <span className="shell-nav__wordmark">APEX</span>
      </a>
      <div className="shell-nav__tools">
        <button
          type="button"
          className={menuOpen ? 'shell-nav__menu is-open' : 'shell-nav__menu'}
          aria-expanded={menuOpen}
          aria-controls={menuId}
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          onClick={toggleMenu}
        >
          <svg className="shell-nav__burger" viewBox="0 0 16 16" aria-hidden="true">
            {menuOpen
              ? <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              : <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />}
          </svg>
        </button>
        <button
          type="button"
          className="shell-nav__sound"
          onClick={toggleSound}
          aria-pressed={sound}
          aria-label={sound ? 'Music and menu sounds on' : 'Music and menu sounds off'}
          title={sound ? 'Music and menu sounds on' : 'Music and menu sounds off'}
        >
          ♪
        </button>
      </div>
      <nav id={menuId} aria-label="Primary" className={menuOpen ? 'is-open' : undefined}>
        {LINKS.map((link) => (
          <a
            key={link.name}
            href={routeHref(link.name)}
            className={current === link.name ? 'is-active' : undefined}
            aria-current={current === link.name ? 'page' : undefined}
            onClick={() => setMenuOpen(false)}
          >
            {link.label}
          </a>
        ))}
        <a href={routeHref('race')} className="shell-nav__watch" onClick={() => setMenuOpen(false)}>Watch the Simulation</a>
      </nav>
    </header>
  );
}
