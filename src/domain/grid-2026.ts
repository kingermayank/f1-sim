import { parseRatings, type Driver, type Ratings, type Team } from './race-types';

export const TEAMS_2026: readonly Team[] = [
  { id: 'mercedes', name: 'Mercedes', color: '#00A19C', accent: '#C8CCCE' },
  { id: 'ferrari', name: 'Ferrari', color: '#E80020', accent: '#FFF200' },
  { id: 'mclaren', name: 'McLaren', color: '#FF8000', accent: '#47C7FC' },
  { id: 'red-bull', name: 'Red Bull Racing', color: '#3671C6', accent: '#FCD700' },
  { id: 'racing-bulls', name: 'Racing Bulls', color: '#6692FF', accent: '#FFFFFF' },
  { id: 'alpine', name: 'Alpine', color: '#FF87BC', accent: '#2293D1' },
  { id: 'haas', name: 'Haas F1 Team', color: '#B6BABD', accent: '#E6002D' },
  { id: 'audi', name: 'Audi', color: '#F50537', accent: '#B7FF00' },
  { id: 'williams', name: 'Williams', color: '#1868DB', accent: '#00A0DE' },
  { id: 'aston-martin', name: 'Aston Martin', color: '#229971', accent: '#CEDC00' },
  { id: 'cadillac', name: 'Cadillac', color: '#C8A96B', accent: '#111111' },
];

const base: Ratings = {
  pace: 0.8, qualifying: 0.8, consistency: 0.8, overtaking: 0.8, defending: 0.8,
  tireManagement: 0.8, wetSkill: 0.8, reliability: 0.9, incidentAvoidance: 0.85, pitExecution: 0.85,
};
const rated = (overrides: Partial<Ratings>): Ratings => ({ ...base, ...overrides });

const drivers: readonly Driver[] = [
  { id: 'russell', name: 'George Russell', abbreviation: 'RUS', number: 63, nationality: 'GBR', teamId: 'mercedes', color: '#00A19C', ratings: rated({ pace: 0.93, qualifying: 0.94, consistency: 0.92 }) },
  { id: 'antonelli', name: 'Kimi Antonelli', abbreviation: 'ANT', number: 12, nationality: 'ITA', teamId: 'mercedes', color: '#00A19C', ratings: rated({ pace: 0.96, qualifying: 0.94, consistency: 0.91, overtaking: 0.92 }) },
  { id: 'leclerc', name: 'Charles Leclerc', abbreviation: 'LEC', number: 16, nationality: 'MON', teamId: 'ferrari', color: '#E80020', ratings: rated({ pace: 0.94, qualifying: 0.98, defending: 0.91 }) },
  { id: 'hamilton', name: 'Lewis Hamilton', abbreviation: 'HAM', number: 44, nationality: 'GBR', teamId: 'ferrari', color: '#E80020', ratings: rated({ pace: 0.95, consistency: 0.94, tireManagement: 0.97, wetSkill: 0.98 }) },
  { id: 'norris', name: 'Lando Norris', abbreviation: 'NOR', number: 1, nationality: 'GBR', teamId: 'mclaren', color: '#FF8000', ratings: rated({ pace: 0.93, qualifying: 0.93, consistency: 0.92 }) },
  { id: 'piastri', name: 'Oscar Piastri', abbreviation: 'PIA', number: 81, nationality: 'AUS', teamId: 'mclaren', color: '#FF8000', ratings: rated({ pace: 0.92, consistency: 0.93, tireManagement: 0.92 }) },
  { id: 'verstappen', name: 'Max Verstappen', abbreviation: 'VER', number: 3, nationality: 'NED', teamId: 'red-bull', color: '#3671C6', ratings: rated({ pace: 0.96, qualifying: 0.96, overtaking: 0.97, defending: 0.97, wetSkill: 0.98 }) },
  { id: 'hadjar', name: 'Isack Hadjar', abbreviation: 'HAD', number: 6, nationality: 'FRA', teamId: 'red-bull', color: '#3671C6', ratings: rated({ pace: 0.9, qualifying: 0.89, overtaking: 0.9 }) },
  { id: 'lawson', name: 'Liam Lawson', abbreviation: 'LAW', number: 30, nationality: 'NZL', teamId: 'racing-bulls', color: '#6692FF', ratings: rated({ pace: 0.86, defending: 0.88, incidentAvoidance: 0.8 }) },
  { id: 'lindblad', name: 'Arvid Lindblad', abbreviation: 'LIN', number: 41, nationality: 'GBR', teamId: 'racing-bulls', color: '#6692FF', ratings: rated({ pace: 0.84, qualifying: 0.86, incidentAvoidance: 0.76 }) },
  { id: 'gasly', name: 'Pierre Gasly', abbreviation: 'GAS', number: 10, nationality: 'FRA', teamId: 'alpine', color: '#FF87BC', ratings: rated({ pace: 0.91, qualifying: 0.9, consistency: 0.9, tireManagement: 0.91 }) },
  { id: 'colapinto', name: 'Franco Colapinto', abbreviation: 'COL', number: 43, nationality: 'ARG', teamId: 'alpine', color: '#FF87BC', ratings: rated({ pace: 0.82, overtaking: 0.85, incidentAvoidance: 0.76 }) },
  { id: 'ocon', name: 'Esteban Ocon', abbreviation: 'OCO', number: 31, nationality: 'FRA', teamId: 'haas', color: '#B6BABD', ratings: rated({ pace: 0.82, defending: 0.87, consistency: 0.84 }) },
  { id: 'bearman', name: 'Oliver Bearman', abbreviation: 'BEA', number: 87, nationality: 'GBR', teamId: 'haas', color: '#B6BABD', ratings: rated({ pace: 0.85, qualifying: 0.85, overtaking: 0.86 }) },
  { id: 'hulkenberg', name: 'Nico Hulkenberg', abbreviation: 'HUL', number: 27, nationality: 'GER', teamId: 'audi', color: '#F50537', ratings: rated({ pace: 0.84, qualifying: 0.88, consistency: 0.86 }) },
  { id: 'bortoleto', name: 'Gabriel Bortoleto', abbreviation: 'BOR', number: 5, nationality: 'BRA', teamId: 'audi', color: '#F50537', ratings: rated({ pace: 0.83, tireManagement: 0.84, incidentAvoidance: 0.82 }) },
  { id: 'sainz', name: 'Carlos Sainz', abbreviation: 'SAI', number: 55, nationality: 'ESP', teamId: 'williams', color: '#1868DB', ratings: rated({ pace: 0.88, consistency: 0.91, tireManagement: 0.92 }) },
  { id: 'albon', name: 'Alexander Albon', abbreviation: 'ALB', number: 23, nationality: 'THA', teamId: 'williams', color: '#1868DB', ratings: rated({ pace: 0.86, qualifying: 0.88, overtaking: 0.87 }) },
  { id: 'alonso', name: 'Fernando Alonso', abbreviation: 'ALO', number: 14, nationality: 'ESP', teamId: 'aston-martin', color: '#229971', ratings: rated({ pace: 0.87, consistency: 0.94, overtaking: 0.95, defending: 0.96, wetSkill: 0.96 }) },
  { id: 'stroll', name: 'Lance Stroll', abbreviation: 'STR', number: 18, nationality: 'CAN', teamId: 'aston-martin', color: '#229971', ratings: rated({ pace: 0.78, wetSkill: 0.85, incidentAvoidance: 0.75 }) },
  { id: 'perez', name: 'Sergio Perez', abbreviation: 'PER', number: 11, nationality: 'MEX', teamId: 'cadillac', color: '#C8A96B', ratings: rated({ pace: 0.78, tireManagement: 0.88, defending: 0.86, reliability: 0.82 }) },
  { id: 'bottas', name: 'Valtteri Bottas', abbreviation: 'BOT', number: 77, nationality: 'FIN', teamId: 'cadillac', color: '#C8A96B', ratings: rated({ pace: 0.79, qualifying: 0.84, consistency: 0.86, reliability: 0.83 }) },
];

export const DRIVERS_2026: readonly Driver[] = Object.freeze(
  drivers.map((driver) => Object.freeze({ ...driver, ratings: Object.freeze(parseRatings(driver.ratings)) })),
);
