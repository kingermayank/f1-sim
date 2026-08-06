import { DRIVERS_2026 } from '../domain/grid-2026';
import type { CarState, RaceEvent, RaceState } from '../simulation/events';

/**
 * Turns a race event into a plain-English reason.
 *
 * This is the product's core value: a newcomer can see *why* something happened
 * rather than just that it happened. It is a pure function of the event plus the
 * race state around it, which keeps it fully unit-testable with no renderer.
 *
 * The rule for every explanation: say the CAUSE, not a restatement of the event.
 * "Hamilton pitted" is not an explanation; "his tyres were costing more per lap
 * than a stop would" is.
 */
export interface Explanation {
  /** What happened, in neutral language. */
  headline: string;
  /** Why it happened. The part that does the work. */
  reason: string;
  /** Glossary terms referenced, for tooltip decoration. */
  terms: string[];
}

const NAMES = new Map(DRIVERS_2026.map((driver) => [driver.id, driver.name]));

function name(driverId: string): string {
  return NAMES.get(driverId) ?? driverId;
}

function carOf(state: RaceState, driverId: string): CarState | undefined {
  return state.cars.find((car) => car.driverId === driverId);
}

const COMPOUND_LABEL: Record<string, string> = {
  soft: 'soft', medium: 'medium', hard: 'hard', intermediate: 'intermediate', wet: 'wet',
};

/** Softer tyres are quicker but wear faster; this drives most pit explanations. */
const COMPOUND_RANK: Record<string, number> = { soft: 0, medium: 1, hard: 2, intermediate: 3, wet: 4 };

function wearPhrase(wear: number): string {
  if (wear >= 0.75) return 'badly worn';
  if (wear >= 0.5) return 'well used';
  if (wear >= 0.25) return 'starting to go off';
  return 'still fresh';
}

export function explainEvent(event: RaceEvent, state: RaceState): Explanation | null {
  switch (event.type) {
    case 'start':
      return {
        headline: 'Lights out',
        reason:
          'Everyone starts on the tyre they qualified on, so the opening laps are as much about holding '
          + 'position as raw pace.',
        terms: ['compound'],
      };

    case 'pit-entry': {
      const car = carOf(state, event.driverId);
      const wear = car?.tire.wear ?? 0;
      return {
        headline: `${name(event.driverId)} came into the pits`,
        reason: car
          ? `Their tyres were ${wearPhrase(wear)} at around ${Math.round(wear * 100)}% wear. Once `
            + 'degradation costs more per lap than the roughly twenty-four seconds a stop takes, '
            + 'staying out is the slower option.'
          : 'Their tyres had passed the point where staying out was costing more than a stop would.',
        terms: ['degradation', 'pit window'],
      };
    }

    case 'tire-change': {
      const car = carOf(state, event.driverId);
      const previous = car?.tire.compound;
      const goingHarder = previous !== undefined
        && (COMPOUND_RANK[event.compound] ?? 1) > (COMPOUND_RANK[previous] ?? 1);
      return {
        headline: `${name(event.driverId)} fitted ${COMPOUND_LABEL[event.compound] ?? event.compound} tyres`,
        reason: goingHarder
          ? 'A harder tyre gives away some lap time but lasts longer — the bet is that one fewer stop '
            + 'beats being marginally quicker.'
          : 'A softer tyre is quicker straight away. The bet is that the time gained now outweighs the '
            + 'faster wear later.',
        terms: ['compound', 'stint'],
      };
    }

    case 'overtake': {
      const attacker = carOf(state, event.attackerId);
      const defender = carOf(state, event.defenderId);
      const fresher = attacker && defender && attacker.tire.wear < defender.tire.wear - 0.12;
      return {
        headline: `${name(event.attackerId)} passed ${name(event.defenderId)} for P${event.position}`,
        reason: fresher
          ? 'Fresher tyres. The car behind had significantly more grip, which is usually enough to make '
            + 'a move stick on the next straight.'
          : 'Close enough through the previous corner to use DRS on the straight, then late on the brakes. '
            + 'DRS closes the gap; the driver still has to complete the move.',
        terms: fresher ? ['degradation'] : ['DRS', 'dirty air'],
      };
    }

    case 'flag':
      if (event.flag === 'safety-car') {
        return {
          headline: 'Safety car deployed',
          reason:
            'The track is unsafe, so the field bunches up behind it. Leads disappear and a pit stop '
            + 'suddenly costs far less time — expect the order to be reshuffled.',
          terms: ['safety car', 'pit window'],
        };
      }
      if (event.flag === 'yellow') {
        return {
          headline: 'Yellow flag',
          reason: 'There is a hazard on track. Drivers must slow through that sector and cannot overtake.',
          terms: ['yellow flag'],
        };
      }
      return {
        headline: 'Green flag',
        reason: 'The hazard is cleared. Racing resumes and overtaking is allowed again.',
        terms: [],
      };

    case 'incident': {
      const who = event.driverIds.map(name).join(' and ');
      return {
        headline: `Incident involving ${who}`,
        reason: event.severity === 'major'
          ? 'Serious enough to affect the race — expect damage, lost time, and possibly a safety car.'
          : 'A minor knock. It costs a little time and can leave damage that slowly bleeds lap time.',
        terms: event.severity === 'major' ? ['safety car'] : [],
      };
    }

    case 'retirement':
      return {
        headline: `${name(event.driverId)} retired`,
        reason: `Out of the race with ${event.reason} trouble. Their race ends here; everyone behind moves up a place.`,
        terms: [],
      };

    case 'weather':
      return {
        headline: `Conditions changed to ${event.weather}`,
        reason:
          'Grip changes with the track surface, and the right tyre changes with it. A wrong call here '
          + 'can cost more than any overtake.',
        terms: ['compound'],
      };

    case 'finish':
      return {
        headline: `${name(event.driverId)} finished P${event.position}`,
        reason: event.position === 1
          ? 'Took the win — the sum of qualifying position, tyre calls, and clean air at the right moments.'
          : 'Race complete. Final position is decided as much by strategy as by outright pace.',
        terms: ['clean air'],
      };

    // Sector and lap events are routine timing, not moments worth narrating.
    case 'sector':
    case 'lap':
    default:
      return null;
  }
}

/** Events worth surfacing in the annotated feed, newest first. */
export function explainFeed(state: RaceState, limit = 12): { event: RaceEvent; explanation: Explanation }[] {
  const out: { event: RaceEvent; explanation: Explanation }[] = [];
  for (let index = state.events.length - 1; index >= 0 && out.length < limit; index -= 1) {
    const event = state.events[index];
    const explanation = explainEvent(event, state);
    if (explanation) out.push({ event, explanation });
  }
  return out;
}
