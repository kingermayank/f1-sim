/**
 * Client for the OpenF1 API (https://openf1.org) — free, keyless, real and
 * historical Formula 1 data.
 *
 * The API sends `access-control-allow-origin: *`, so the browser calls it
 * directly and the product stays backend-free.
 *
 * Every call here is best-effort. Real data enriches the experience but must
 * never break it: requests time out, results are cached for the session, and a
 * failure resolves to null so the caller can simply render without live data.
 */
export const OPENF1_BASE = 'https://api.openf1.org/v1';

const REQUEST_TIMEOUT_MS = 8000;

export interface OpenF1Session {
  session_key: number;
  meeting_key: number;
  session_name: string;
  session_type: string;
  date_start: string;
  circuit_short_name: string;
  country_name: string;
  year: number;
}

export interface OpenF1Driver {
  driver_number: number;
  name_acronym: string;
  full_name: string;
  team_name: string;
  team_colour?: string;
}

export interface OpenF1Result {
  position: number | null;
  driver_number: number;
  number_of_laps?: number;
  points?: number;
  dnf?: boolean;
  dns?: boolean;
  dsq?: boolean;
  duration?: number | number[];
  gap_to_leader?: number | string | null;
}

export interface OpenF1Stint {
  driver_number: number;
  stint_number: number;
  lap_start: number;
  lap_end: number;
  compound: string;
  tyre_age_at_start: number;
}

export interface OpenF1CarData {
  date: string;
  driver_number: number;
  speed: number;
  throttle: number;
  brake: number;
  n_gear: number;
  rpm: number;
  drs: number | null;
}

const cache = new Map<string, unknown>();

/** Fetches a JSON array from OpenF1, or null if anything goes wrong. */
export async function openF1<T>(path: string, params: Record<string, string | number> = {}): Promise<T[] | null> {
  const query = Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
  const url = `${OPENF1_BASE}/${path}${query ? `?${query}` : ''}`;

  if (cache.has(url)) return cache.get(url) as T[];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    const payload = await response.json();
    if (!Array.isArray(payload)) return null;
    cache.set(url, payload);
    return payload as T[];
  } catch {
    // Offline, blocked, timed out or rate limited — the caller renders without it.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The race session for a meeting. Sprints share `session_type`, so match the name. */
export async function raceSession(meetingKey: number): Promise<OpenF1Session | null> {
  const sessions = await openF1<OpenF1Session>('sessions', { meeting_key: meetingKey });
  if (!sessions) return null;
  return sessions.find((session) => session.session_name === 'Race') ?? null;
}

export async function sessionResult(sessionKey: number): Promise<OpenF1Result[] | null> {
  const rows = await openF1<OpenF1Result>('session_result', { session_key: sessionKey });
  if (!rows) return null;
  return [...rows].sort((a, b) => (a.position ?? 99) - (b.position ?? 99));
}

export async function sessionDrivers(sessionKey: number): Promise<OpenF1Driver[] | null> {
  return openF1<OpenF1Driver>('drivers', { session_key: sessionKey });
}

export async function driverStints(sessionKey: number, driverNumber: number): Promise<OpenF1Stint[] | null> {
  const rows = await openF1<OpenF1Stint>('stints', { session_key: sessionKey, driver_number: driverNumber });
  if (!rows) return null;
  return [...rows].sort((a, b) => a.stint_number - b.stint_number);
}

/**
 * Telemetry is very high frequency, so callers must narrow it. `speedFloor`
 * maps to OpenF1's `speed>=` filter, which is the cheapest way to pull a
 * representative sample of a driver at full commitment.
 */
export async function driverTelemetry(
  sessionKey: number,
  driverNumber: number,
  speedFloor = 300,
): Promise<OpenF1CarData[] | null> {
  return openF1<OpenF1CarData>('car_data', {
    session_key: sessionKey,
    driver_number: driverNumber,
    'speed>=': speedFloor,
  });
}

/** Formats an OpenF1 race duration (seconds) as h:mm:ss.mmm. */
export function formatRaceDuration(seconds: number | number[] | undefined): string {
  const value = Array.isArray(seconds) ? seconds[0] : seconds;
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const secs = value % 60;
  const secondsText = secs.toFixed(3).padStart(6, '0');
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${secondsText}`
    : `${minutes}:${secondsText}`;
}

export function formatGap(gap: number | string | null | undefined): string {
  if (gap === 0) return 'Winner';
  if (typeof gap === 'number') return `+${gap.toFixed(3)}`;
  if (typeof gap === 'string' && gap.length > 0) return gap;
  return '—';
}
