import type { RaceEvent } from '../simulation/events';

export const BROADCAST_SHOT_MIN_SECONDS = 3;
export const BROADCAST_SHOT_MAX_SECONDS = 10;
const REDUCED_MOTION_MIN_SECONDS = 5;
const URGENT_INTERRUPT_SECONDS = 1;
const REDUCED_MOTION_INTERRUPT_SECONDS = 2;
const CLOSE_GAP_DISTANCE = 0.012;

export type CameraDirectorMode = 'broadcast' | 'chase' | 'cockpit' | 'overhead' | 'free';
export type CameraDirectorEvent =
  | Exclude<RaceEvent, { type: 'incident' }>
  | (Readonly<Omit<Extract<RaceEvent, { type: 'incident' }>, 'driverIds'>> & {
      readonly driverIds: readonly string[];
    });
export type BroadcastShotReason =
  | 'start'
  | 'finish'
  | 'incident'
  | 'overtake'
  | 'pit'
  | 'close-gap'
  | 'fastest-lap'
  | 'running';

export interface CameraDirectorCar {
  driverId: string;
  lap: number;
  distance: number;
  position: number;
  pitState: 'track' | 'entry' | 'lane' | 'exit' | 'stopped';
  status: 'running' | 'finished' | 'retired';
}

export interface BroadcastShot {
  action: 'cut' | 'hold';
  reason: BroadcastShotReason;
  targetDriverId: string | null;
  secondaryDriverId: string | null;
  eventTick: number | null;
  anchorIndex: number;
}

export interface BroadcastDirectorInput {
  now: number;
  lastCutAt: number;
  events: readonly CameraDirectorEvent[];
  cars?: readonly CameraDirectorCar[];
  selectedDriverId?: string | null;
  currentShot?: BroadcastShot;
  cameraMode?: CameraDirectorMode;
  reducedMotion?: boolean;
  anchorCount?: number;
}

interface Candidate {
  reason: BroadcastShotReason;
  priority: number;
  targetDriverId: string | null;
  secondaryDriverId: string | null;
  eventTick: number | null;
  urgent: boolean;
}

function holdShot(input: BroadcastDirectorInput): BroadcastShot {
  const current = input.currentShot;
  return current ? { ...current, action: 'hold' } : {
    action: 'hold',
    reason: 'running',
    targetDriverId: input.selectedDriverId ?? null,
    secondaryDriverId: null,
    eventTick: null,
    anchorIndex: 0,
  };
}

function candidateFromEvent(event: CameraDirectorEvent, fastestLapTick: number | null): Candidate | null {
  switch (event.type) {
    case 'finish':
      return { reason: 'finish', priority: 100, targetDriverId: event.driverId, secondaryDriverId: null, eventTick: event.tick, urgent: true };
    case 'start':
      return { reason: 'start', priority: 95, targetDriverId: null, secondaryDriverId: null, eventTick: event.tick, urgent: false };
    case 'incident':
      return {
        reason: 'incident',
        priority: event.severity === 'major' ? 90 : 70,
        targetDriverId: event.driverIds[0] ?? null,
        secondaryDriverId: event.driverIds[1] ?? null,
        eventTick: event.tick,
        urgent: event.severity === 'major',
      };
    case 'overtake':
      return { reason: 'overtake', priority: 80, targetDriverId: event.attackerId, secondaryDriverId: event.defenderId, eventTick: event.tick, urgent: false };
    case 'pit-entry':
    case 'pit-exit':
    case 'tire-change':
      return { reason: 'pit', priority: 60, targetDriverId: event.driverId, secondaryDriverId: null, eventTick: event.tick, urgent: false };
    case 'lap':
      return event.tick === fastestLapTick
        ? { reason: 'fastest-lap', priority: 40, targetDriverId: event.driverId, secondaryDriverId: null, eventTick: event.tick, urgent: false }
        : null;
    default:
      return null;
  }
}

function isBetterCandidate(candidate: Candidate, current: Candidate): boolean {
  return candidate.priority > current.priority
    || (candidate.priority === current.priority && (candidate.eventTick ?? -1) > (current.eventTick ?? -1));
}

function findFastestLapTick(events: readonly CameraDirectorEvent[]): number | null {
  let bestTime = Number.POSITIVE_INFINITY;
  let bestTick: number | null = null;
  for (const event of events) {
    if (event.type !== 'lap') continue;
    if (event.lapTime < bestTime || (event.lapTime === bestTime && event.tick > (bestTick ?? -1))) {
      bestTime = event.lapTime;
      bestTick = event.tick;
    }
  }
  return bestTick;
}

function findCloseGap(cars: readonly CameraDirectorCar[] | undefined): Candidate | null {
  if (!cars || cars.length < 2) return null;
  let leader: CameraDirectorCar | null = null;
  let follower: CameraDirectorCar | null = null;
  let smallestGap = Number.POSITIVE_INFINITY;

  for (const possibleLeader of cars) {
    if (possibleLeader.status !== 'running' || possibleLeader.pitState !== 'track') continue;
    for (const possibleFollower of cars) {
      if (
        possibleFollower.status !== 'running'
        || possibleFollower.pitState !== 'track'
        || possibleFollower.position !== possibleLeader.position + 1
      ) continue;
      const leaderProgress = possibleLeader.lap + possibleLeader.distance;
      const followerProgress = possibleFollower.lap + possibleFollower.distance;
      const gap = leaderProgress - followerProgress;
      if (gap >= 0 && gap <= CLOSE_GAP_DISTANCE && gap < smallestGap) {
        leader = possibleLeader;
        follower = possibleFollower;
        smallestGap = gap;
      }
    }
  }

  return leader && follower ? {
    reason: 'close-gap',
    priority: 50,
    targetDriverId: follower.driverId,
    secondaryDriverId: leader.driverId,
    eventTick: null,
    urgent: false,
  } : null;
}

function selectCandidate(input: BroadcastDirectorInput): Candidate {
  const runningCar = input.cars?.find((car) => car.driverId === input.selectedDriverId)
    ?? input.cars?.find((car) => car.position === 1)
    ?? input.cars?.[0];
  let best: Candidate = {
    reason: 'running',
    priority: 10,
    targetDriverId: input.selectedDriverId ?? runningCar?.driverId ?? null,
    secondaryDriverId: null,
    eventTick: null,
    urgent: false,
  };

  const fastestLapTick = findFastestLapTick(input.events);
  for (const event of input.events) {
    if (input.currentShot?.eventTick !== null && input.currentShot?.eventTick !== undefined && event.tick <= input.currentShot.eventTick) continue;
    const candidate = candidateFromEvent(event, fastestLapTick);
    if (candidate && isBetterCandidate(candidate, best)) best = candidate;
  }

  const closeGap = findCloseGap(input.cars);
  if (closeGap && isBetterCandidate(closeGap, best)) best = closeGap;
  return best;
}

function nextAnchorIndex(input: BroadcastDirectorInput, candidate: Candidate): number {
  const count = Math.max(1, Math.floor(input.anchorCount ?? 1));
  if (input.currentShot && count > 1) return (input.currentShot.anchorIndex + 1) % count;
  const seed = (candidate.eventTick ?? Math.floor(input.now))
    + (candidate.targetDriverId?.length ?? 0)
    + candidate.reason.length;
  return Math.abs(seed) % count;
}

function isSameSubject(current: BroadcastShot, candidate: Candidate): boolean {
  return current.reason === candidate.reason
    && current.targetDriverId === candidate.targetDriverId
    && current.secondaryDriverId === candidate.secondaryDriverId
    && current.eventTick === candidate.eventTick;
}

/** Pure, deterministic broadcast decision. It never reads clocks or mutable scene state. */
export function selectBroadcastShot(input: BroadcastDirectorInput): BroadcastShot {
  if ((input.cameraMode ?? 'broadcast') !== 'broadcast') return holdShot(input);

  const elapsed = Math.max(0, input.now - input.lastCutAt);
  const candidate = selectCandidate(input);
  const minimum = input.reducedMotion ? REDUCED_MOTION_MIN_SECONDS : BROADCAST_SHOT_MIN_SECONDS;
  const urgentMinimum = input.reducedMotion ? REDUCED_MOTION_INTERRUPT_SECONDS : URGENT_INTERRUPT_SECONDS;

  if (elapsed < (candidate.urgent ? urgentMinimum : minimum)) return holdShot(input);
  if (input.currentShot && elapsed < BROADCAST_SHOT_MAX_SECONDS && isSameSubject(input.currentShot, candidate)) {
    return holdShot(input);
  }

  return {
    action: 'cut',
    reason: candidate.reason,
    targetDriverId: candidate.targetDriverId,
    secondaryDriverId: candidate.secondaryDriverId,
    eventTick: candidate.eventTick,
    anchorIndex: nextAnchorIndex(input, candidate),
  };
}
