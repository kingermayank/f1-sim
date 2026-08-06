/**
 * The 2026 Formula 1 calendar.
 *
 * Source of truth is formula1.com's official schedule (23 rounds). OpenF1's
 * 2026 session list disagrees with it in places — it carries an extra Sakhir
 * round in April, a Jeddah round the official calendar does not list, and a
 * "Kuala Lumpur" meeting filed under Bahrain even though there is no Malaysian
 * Grand Prix in 2026. So the calendar below is curated from the official
 * source, and `openF1MeetingKey` is attached only where a round matches an
 * OpenF1 meeting with confidence. That keeps the listing correct while still
 * letting us pull real results and telemetry.
 */
export interface CalendarRound {
  round: number;
  id: string;
  name: string;
  circuit: string;
  country: string;
  countryCode: string;
  /** Race day, ISO date. */
  date: string;
  lengthKm: number;
  laps: number;
  turns: number;
  /** OpenF1 meeting key, where a confident match exists. */
  openF1MeetingKey?: number;
}

export const CALENDAR_2026: readonly CalendarRound[] = [
  { round: 1, id: 'melbourne', name: 'Australian Grand Prix', circuit: 'Albert Park', country: 'Australia', countryCode: 'AUS', date: '2026-03-08', lengthKm: 5.278, laps: 58, turns: 14, openF1MeetingKey: 1279 },
  { round: 2, id: 'shanghai', name: 'Chinese Grand Prix', circuit: 'Shanghai International Circuit', country: 'China', countryCode: 'CHN', date: '2026-03-15', lengthKm: 5.451, laps: 56, turns: 16, openF1MeetingKey: 1280 },
  { round: 3, id: 'suzuka', name: 'Japanese Grand Prix', circuit: 'Suzuka', country: 'Japan', countryCode: 'JPN', date: '2026-03-29', lengthKm: 5.807, laps: 53, turns: 18, openF1MeetingKey: 1281 },
  { round: 4, id: 'miami', name: 'Miami Grand Prix', circuit: 'Miami International Autodrome', country: 'United States', countryCode: 'USA', date: '2026-05-03', lengthKm: 5.412, laps: 57, turns: 19, openF1MeetingKey: 1284 },
  { round: 5, id: 'montreal', name: 'Canadian Grand Prix', circuit: 'Circuit Gilles-Villeneuve', country: 'Canada', countryCode: 'CAN', date: '2026-05-24', lengthKm: 4.361, laps: 70, turns: 14, openF1MeetingKey: 1285 },
  { round: 6, id: 'monaco', name: 'Monaco Grand Prix', circuit: 'Circuit de Monaco', country: 'Monaco', countryCode: 'MON', date: '2026-06-07', lengthKm: 3.337, laps: 78, turns: 19, openF1MeetingKey: 1286 },
  { round: 7, id: 'catalunya', name: 'Barcelona-Catalunya Grand Prix', circuit: 'Circuit de Barcelona-Catalunya', country: 'Spain', countryCode: 'ESP', date: '2026-06-14', lengthKm: 4.657, laps: 66, turns: 14, openF1MeetingKey: 1287 },
  { round: 8, id: 'spielberg', name: 'Austrian Grand Prix', circuit: 'Red Bull Ring', country: 'Austria', countryCode: 'AUT', date: '2026-06-28', lengthKm: 4.318, laps: 71, turns: 10, openF1MeetingKey: 1288 },
  { round: 9, id: 'silverstone', name: 'British Grand Prix', circuit: 'Silverstone', country: 'United Kingdom', countryCode: 'GBR', date: '2026-07-05', lengthKm: 5.891, laps: 52, turns: 18, openF1MeetingKey: 1289 },
  { round: 10, id: 'spa', name: 'Belgian Grand Prix', circuit: 'Spa-Francorchamps', country: 'Belgium', countryCode: 'BEL', date: '2026-07-19', lengthKm: 7.004, laps: 44, turns: 19, openF1MeetingKey: 1290 },
  { round: 11, id: 'hungaroring', name: 'Hungarian Grand Prix', circuit: 'Hungaroring', country: 'Hungary', countryCode: 'HUN', date: '2026-07-26', lengthKm: 4.381, laps: 70, turns: 14, openF1MeetingKey: 1291 },
  { round: 12, id: 'zandvoort', name: 'Dutch Grand Prix', circuit: 'Zandvoort', country: 'Netherlands', countryCode: 'NED', date: '2026-08-23', lengthKm: 4.259, laps: 72, turns: 14, openF1MeetingKey: 1292 },
  { round: 13, id: 'monza', name: 'Italian Grand Prix', circuit: 'Monza', country: 'Italy', countryCode: 'ITA', date: '2026-09-06', lengthKm: 5.793, laps: 53, turns: 11, openF1MeetingKey: 1293 },
  { round: 14, id: 'madring', name: 'Spanish Grand Prix', circuit: 'Madring', country: 'Spain', countryCode: 'ESP', date: '2026-09-13', lengthKm: 5.474, laps: 57, turns: 22, openF1MeetingKey: 1294 },
  { round: 15, id: 'baku', name: 'Azerbaijan Grand Prix', circuit: 'Baku City Circuit', country: 'Azerbaijan', countryCode: 'AZE', date: '2026-09-26', lengthKm: 6.003, laps: 51, turns: 20, openF1MeetingKey: 1295 },
  { round: 16, id: 'sakhir', name: 'Bahrain Grand Prix', circuit: 'Bahrain International Circuit', country: 'Bahrain', countryCode: 'BHR', date: '2026-10-04', lengthKm: 5.412, laps: 57, turns: 15 },
  { round: 17, id: 'singapore', name: 'Singapore Grand Prix', circuit: 'Marina Bay Street Circuit', country: 'Singapore', countryCode: 'SGP', date: '2026-10-11', lengthKm: 4.940, laps: 62, turns: 19, openF1MeetingKey: 1296 },
  { round: 18, id: 'austin', name: 'United States Grand Prix', circuit: 'Circuit of the Americas', country: 'United States', countryCode: 'USA', date: '2026-10-25', lengthKm: 5.513, laps: 56, turns: 20, openF1MeetingKey: 1297 },
  { round: 19, id: 'mexico-city', name: 'Mexico City Grand Prix', circuit: 'Autódromo Hermanos Rodríguez', country: 'Mexico', countryCode: 'MEX', date: '2026-11-01', lengthKm: 4.304, laps: 71, turns: 17, openF1MeetingKey: 1298 },
  { round: 20, id: 'interlagos', name: 'São Paulo Grand Prix', circuit: 'Interlagos', country: 'Brazil', countryCode: 'BRA', date: '2026-11-08', lengthKm: 4.309, laps: 71, turns: 15, openF1MeetingKey: 1299 },
  { round: 21, id: 'las-vegas', name: 'Las Vegas Grand Prix', circuit: 'Las Vegas Strip Circuit', country: 'United States', countryCode: 'USA', date: '2026-11-22', lengthKm: 6.201, laps: 50, turns: 17, openF1MeetingKey: 1300 },
  { round: 22, id: 'lusail', name: 'Qatar Grand Prix', circuit: 'Lusail International Circuit', country: 'Qatar', countryCode: 'QAT', date: '2026-11-29', lengthKm: 5.419, laps: 57, turns: 16, openF1MeetingKey: 1301 },
  { round: 23, id: 'yas-marina', name: 'Abu Dhabi Grand Prix', circuit: 'Yas Marina Circuit', country: 'United Arab Emirates', countryCode: 'UAE', date: '2026-12-06', lengthKm: 5.281, laps: 58, turns: 16, openF1MeetingKey: 1302 },
];

export function findRound(id: string): CalendarRound | undefined {
  return CALENDAR_2026.find((round) => round.id === id);
}

/** Rounds whose race date has already passed, so real results should exist. */
export function completedRounds(now: Date = new Date()): readonly CalendarRound[] {
  const today = now.toISOString().slice(0, 10);
  return CALENDAR_2026.filter((round) => round.date < today);
}

export function nextRound(now: Date = new Date()): CalendarRound | undefined {
  const today = now.toISOString().slice(0, 10);
  return CALENDAR_2026.find((round) => round.date >= today);
}
