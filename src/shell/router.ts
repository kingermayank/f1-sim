import { useEffect, useState } from 'react';

/**
 * Hash routing, deliberately dependency-free.
 *
 * Keeps the app a static build that works from any host (and from `file://`)
 * with no server rewrite rules, which matters because this product is
 * frontend-only with no backend.
 */
export const ROUTES = ['home', 'circuits', 'circuit', 'garage', 'drivers', 'learn', 'race'] as const;
export type RouteName = (typeof ROUTES)[number];

export interface Route {
  name: RouteName;
  /** Present for routes that address a specific record, e.g. `#/circuits/shanghai`. */
  param?: string;
}

const HOME: Route = { name: 'home' };

export function parseHash(hash: string): Route {
  const cleaned = hash.replace(/^#\/?/, '').replace(/\/+$/, '');
  if (!cleaned) return HOME;

  const [head, tail] = cleaned.split('/');
  switch (head) {
    case 'circuits':
      return tail ? { name: 'circuit', param: tail } : { name: 'circuits' };
    case 'garage':
      return { name: 'garage' };
    case 'drivers':
      return { name: 'drivers' };
    case 'learn':
      return { name: 'learn' };
    case 'race':
      return { name: 'race' };
    default:
      // Unknown routes fall back to home rather than rendering nothing.
      return HOME;
  }
}

export function routeHref(name: RouteName, param?: string): string {
  if (name === 'home') return '#/';
  if (name === 'circuit') return `#/circuits/${param ?? ''}`;
  return `#/${name}`;
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
