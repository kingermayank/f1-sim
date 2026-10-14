import { useEffect, useState } from 'react';

/**
 * Hash routing, deliberately dependency-free.
 *
 * Keeps the app a static build that works from any host (and from `file://`)
 * with no server rewrite rules, which matters because this product is
 * frontend-only with no backend.
 */
export const ROUTES = ['home', 'circuits', 'circuit', 'garage', 'drivers', 'race', 'play', 'play-race'] as const;
export type RouteName = (typeof ROUTES)[number];

export interface Route {
  name: RouteName;
  /** Present for routes that address a specific record, e.g. `#/circuits/shanghai`. */
  param?: string;
}

const HOME: Route = { name: 'home' };

export function parseHash(hash: string): Route {
  // A query after the route (`#/?d=leclerc`) carries page state, not a route.
  const cleaned = hash.replace(/^#\/?/, '').split('?')[0].replace(/\/+$/, '');
  if (!cleaned) return HOME;

  const [head, tail] = cleaned.split('/');
  switch (head) {
    case 'circuits':
      return tail ? { name: 'circuit', param: tail } : { name: 'circuits' };
    case 'garage':
      return { name: 'garage' };
    case 'drivers':
      return { name: 'drivers' };
    case 'race':
      return { name: 'race' };
    case 'play':
      return tail === 'race' ? { name: 'play-race' } : { name: 'play' };
    default:
      // Unknown routes fall back to home rather than rendering nothing.
      return HOME;
  }
}

export function routeHref(name: RouteName, param?: string): string {
  if (name === 'home') return '#/';
  if (name === 'circuit') return `#/circuits/${param ?? ''}`;
  if (name === 'play-race') return '#/play/race';
  return `#/${name}`;
}

/** The query part of the hash, e.g. the shared car in `#/?d=leclerc&t=soft`. */
export function readHashParams(hash = typeof window === 'undefined' ? '' : window.location.hash): URLSearchParams {
  const index = hash.indexOf('?');
  return new URLSearchParams(index < 0 ? '' : hash.slice(index + 1));
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(
    typeof window === 'undefined' ? '' : window.location.hash,
  ));

  useEffect(() => {
    const sync = () => setRoute(parseHash(window.location.hash));
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  return route;
}
