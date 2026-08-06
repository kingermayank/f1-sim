import { GLOSSARY } from '../explain/glossary';

export interface QuizQuestion {
  id: string;
  prompt: string;
  options: string[];
  /** Index into `options`. */
  answer: number;
  /** Glossary term this question teaches, so a wrong answer can link onward. */
  term?: string;
}

/**
 * Questions target the concepts research repeatedly names as the wall for new
 * fans — tyre strategy and DRS first, then the vocabulary around them.
 *
 * Explanations after each answer come from the glossary rather than being
 * written twice, so teaching and testing cannot drift apart.
 */
export const QUIZ_QUESTIONS: readonly QuizQuestion[] = [
  {
    id: 'drs-gap',
    prompt: 'A driver may use DRS only when they are within how much of the car ahead?',
    options: ['One second', 'Three seconds', 'Half a lap', 'Any gap, once per lap'],
    answer: 0,
    term: 'DRS',
  },
  {
    id: 'drs-nature',
    prompt: 'What does DRS actually do?',
    options: [
      'Adds temporary engine power',
      'Opens a rear wing flap to cut drag on straights',
      'Softens the tyres for one lap',
      'Lets a driver ignore track limits',
    ],
    answer: 1,
    term: 'DRS',
  },
  {
    id: 'soft-tyre',
    prompt: 'Compared with a hard tyre, a soft tyre is generally…',
    options: [
      'Faster, but wears out sooner',
      'Slower, but wears out sooner',
      'Faster and longer lasting',
      'Identical, just a different colour',
    ],
    answer: 0,
    term: 'compound',
  },
  {
    id: 'undercut',
    prompt: 'A driver pits before the rival ahead, hoping fresh tyres will gain enough time to emerge in front. This is called…',
    options: ['An overcut', 'An undercut', 'A slipstream', 'A formation lap'],
    answer: 1,
    term: 'undercut',
  },
  {
    id: 'degradation',
    prompt: 'Why does a team eventually pit even though a stop costs around 24 seconds?',
    options: [
      'The rules require a stop every 20 laps',
      'Because worn tyres are losing more time per lap than the stop costs',
      'To refuel the car',
      'To change the driver',
    ],
    answer: 1,
    term: 'degradation',
  },
  {
    id: 'dirty-air',
    prompt: 'Why is it hard to follow another car closely through corners?',
    options: [
      'The engine overheats',
      'Turbulent air behind the car ahead reduces grip',
      'The track is narrower there',
      'Radio interference',
    ],
    answer: 1,
    term: 'dirty air',
  },
  {
    id: 'safety-car',
    prompt: 'What usually happens to the gaps between cars when the safety car is deployed?',
    options: [
      'They stay exactly the same',
      'They close up, because the field bunches behind it',
      'They double',
      'The race is abandoned',
    ],
    answer: 1,
    term: 'safety car',
  },
  {
    id: 'yellow-flag',
    prompt: 'Under a yellow flag, a driver must…',
    options: [
      'Slow down and not overtake in that sector',
      'Pit immediately',
      'Speed up to clear the area',
      'Serve a penalty',
    ],
    answer: 0,
    term: 'yellow flag',
  },
];

export function explanationFor(question: QuizQuestion): string | undefined {
  if (!question.term) return undefined;
  return GLOSSARY.find((entry) => entry.term.toLowerCase() === question.term!.toLowerCase())?.long;
}
