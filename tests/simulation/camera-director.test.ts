import { describe, expect, it } from 'vitest';
import {
  selectBroadcastShot,
  type BroadcastShot,
  type CameraDirectorCar,
} from '../../src/cameras/camera-director';

const currentShot: BroadcastShot = {
  action: 'cut',
  reason: 'running',
  targetDriverId: 'norris',
  secondaryDriverId: null,
  eventTick: null,
  anchorIndex: 0,
};

const closeCars: CameraDirectorCar[] = [
  { driverId: 'norris', lap: 12, distance: 0.52, position: 1, pitState: 'track', status: 'running' },
  { driverId: 'leclerc', lap: 12, distance: 0.511, position: 2, pitState: 'track', status: 'running' },
  { driverId: 'hamilton', lap: 12, distance: 0.43, position: 3, pitState: 'track', status: 'running' },
];

describe('broadcast camera director', () => {
  it('prioritizes a major incident over a routine lap event', () => {
    const shot = selectBroadcastShot({
      now: 20,
      lastCutAt: 10,
      events: [
        { type: 'lap', tick: 200, driverId: 'norris', lap: 2, lapTime: 72 },
        { type: 'incident', tick: 201, driverIds: ['leclerc', 'hamilton'], severity: 'major' },
      ],
    });

    expect(shot.reason).toBe('incident');
    expect(shot.targetDriverId).toBe('leclerc');
  });

  it('ranks start, finish, incidents, overtakes, pits, close gaps, fastest laps, and running', () => {
    expect(selectBroadcastShot({
      now: 20,
      lastCutAt: 10,
      events: [{ type: 'start', tick: 1 }],
    }).reason).toBe('start');

    expect(selectBroadcastShot({
      now: 20,
      lastCutAt: 10,
      events: [
        { type: 'incident', tick: 200, driverIds: ['leclerc'], severity: 'major' },
        { type: 'finish', tick: 201, driverId: 'norris', position: 1 },
      ],
    }).reason).toBe('finish');

    expect(selectBroadcastShot({
      now: 20,
      lastCutAt: 10,
      events: [
        { type: 'pit-entry', tick: 200, driverId: 'leclerc' },
        { type: 'overtake', tick: 201, attackerId: 'norris', defenderId: 'leclerc', position: 1 },
      ],
    }).reason).toBe('overtake');

    expect(selectBroadcastShot({
      now: 20,
      lastCutAt: 10,
      events: [{ type: 'pit-exit', tick: 201, driverId: 'leclerc' }],
      cars: closeCars,
    }).reason).toBe('pit');

    expect(selectBroadcastShot({
      now: 20,
      lastCutAt: 10,
      events: [],
      cars: closeCars,
    }).reason).toBe('close-gap');

    expect(selectBroadcastShot({
      now: 20,
      lastCutAt: 10,
      events: [
        { type: 'lap', tick: 180, driverId: 'leclerc', lap: 2, lapTime: 73 },
        { type: 'lap', tick: 200, driverId: 'norris', lap: 2, lapTime: 72 },
      ],
    }).reason).toBe('fastest-lap');

    expect(selectBroadcastShot({ now: 20, lastCutAt: 10, events: [] }).reason).toBe('running');
  });

  it('holds the current shot during the three-second minimum duration', () => {
    expect(selectBroadcastShot({ now: 11, lastCutAt: 10, events: [] }).action).toBe('hold');
    expect(selectBroadcastShot({ now: 12.999, lastCutAt: 10, events: [] }).action).toBe('hold');
    expect(selectBroadcastShot({ now: 13, lastCutAt: 10, events: [] }).action).toBe('cut');
  });

  it('cuts after the ten-second maximum and advances anchors deterministically', () => {
    const atMaximum = selectBroadcastShot({
      now: 20,
      lastCutAt: 10,
      events: [],
      currentShot,
      anchorCount: 8,
    });
    const replay = selectBroadcastShot({
      now: 20,
      lastCutAt: 10,
      events: [],
      currentShot,
      anchorCount: 8,
    });

    expect(atMaximum.action).toBe('cut');
    expect(atMaximum.anchorIndex).not.toBe(currentShot.anchorIndex);
    expect(replay).toEqual(atMaximum);
  });

  it('lets a finish or major incident interrupt after one second', () => {
    expect(selectBroadcastShot({
      now: 11,
      lastCutAt: 10,
      currentShot,
      events: [{ type: 'finish', tick: 300, driverId: 'norris', position: 1 }],
    }).action).toBe('cut');

    expect(selectBroadcastShot({
      now: 11,
      lastCutAt: 10,
      currentShot,
      events: [{ type: 'incident', tick: 300, driverIds: ['leclerc'], severity: 'major' }],
    }).action).toBe('cut');

    expect(selectBroadcastShot({
      now: 10.9,
      lastCutAt: 10,
      currentShot,
      events: [{ type: 'incident', tick: 300, driverIds: ['leclerc'], severity: 'major' }],
    }).action).toBe('hold');
  });

  it('makes reduced-motion cuts less aggressive without exceeding the maximum', () => {
    expect(selectBroadcastShot({
      now: 14,
      lastCutAt: 10,
      currentShot,
      reducedMotion: true,
      events: [{ type: 'overtake', tick: 300, attackerId: 'leclerc', defenderId: 'norris', position: 1 }],
    }).action).toBe('hold');

    expect(selectBroadcastShot({
      now: 15,
      lastCutAt: 10,
      currentShot,
      reducedMotion: true,
      events: [{ type: 'overtake', tick: 300, attackerId: 'leclerc', defenderId: 'norris', position: 1 }],
    }).action).toBe('cut');

    expect(selectBroadcastShot({
      now: 20,
      lastCutAt: 10,
      currentShot,
      reducedMotion: true,
      events: [],
    }).action).toBe('cut');
  });

  it('suppresses automatic cuts in every manual camera mode', () => {
    for (const cameraMode of ['chase', 'cockpit', 'overhead', 'free'] as const) {
      const shot = selectBroadcastShot({
        now: 30,
        lastCutAt: 10,
        currentShot,
        cameraMode,
        events: [{ type: 'finish', tick: 300, driverId: 'norris', position: 1 }],
      });
      expect(shot.action).toBe('hold');
      expect(shot).toMatchObject({
        reason: currentShot.reason,
        targetDriverId: currentShot.targetDriverId,
        anchorIndex: currentShot.anchorIndex,
      });
    }
  });
});
