import type { CarState, RaceState } from './events';

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function completedDistance(car: CarState): number {
  return car.lap + car.distance;
}

/** Returns a new, deterministic classification without changing race state. */
export function getClassification(state: Pick<RaceState, 'cars'>): CarState[] {
  return [...state.cars].sort((left, right) => {
    const statusRank = (car: CarState) =>
      car.status === 'finished' ? 0 : car.status === 'running' ? 1 : 2;
    const rankDifference = statusRank(left) - statusRank(right);
    if (rankDifference !== 0) return rankDifference;

    if (left.status === 'finished' && right.status === 'finished') {
      const positionDifference = left.finishPosition - right.finishPosition;
      return positionDifference || compareText(left.driverId, right.driverId);
    }

    if (left.status === 'running' && right.status === 'running') {
      const distanceDifference = completedDistance(right) - completedDistance(left);
      return distanceDifference || compareText(left.driverId, right.driverId);
    }

    if (left.status === 'retired' && right.status === 'retired') {
      const retirementDifference = right.retirementTick - left.retirementTick;
      return retirementDifference || compareText(left.driverId, right.driverId);
    }

    return compareText(left.driverId, right.driverId);
  });
}

/**
 * Derives each car's gap to the car furthest around the race using normalized
 * distance and the trailing car's current normalized pace.
 */
export function getIntervals(state: Pick<RaceState, 'cars'>): Map<string, number> {
  const classification = getClassification(state);
  const leader = classification.find((car) => car.status !== 'retired');
  if (!leader) return new Map();

  const leaderDistance = completedDistance(leader);
  return new Map(classification.map((car) => {
    if (car.driverId === leader.driverId) return [car.driverId, 0];

    const distanceGap = Math.max(0, leaderDistance - completedDistance(car));
    const interval = car.speed > 0 ? distanceGap / car.speed : 0;
    return [car.driverId, interval];
  }));
}
