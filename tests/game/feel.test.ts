import { describe, expect, it } from 'vitest';
import { createCarState, stepCar } from '../../src/game/car-physics';
import { resolveCarContact } from '../../src/game/field';
import { createGameStore, projectedTrack } from '../../src/game/game-store';
import { createKeyboardInput } from '../../src/game/input';
import { constrainToWalls } from '../../src/game/track-projection';

const COAST = { throttle: 0, brake: 0, steer: 0, drs: false };

function launch(store: ReturnType<typeof createGameStore>) {
  store.getState().start();
  store.getState().skipIntro();
  for (let t = 0; t < 10 && store.getState().phase === 'lights'; t += 1 / 60) store.getState().step(1 / 60, COAST);
  expect(store.getState().phase).toBe('racing');
}

describe('surfaces', () => {
  it('treats kerbs as a racing surface, only grass as off track', () => {
    const run = (surface: 'tarmac' | 'kerb' | 'grass') => {
      let car = createCarState(0, 0, 0);
      for (let t = 0; t < 6; t += 1 / 60) car = stepCar(car, { ...COAST, throttle: 1 }, { onTrack: true, surface, drsAvailable: false }, 1 / 60);
      return car.speed;
    };
    const tarmac = run('tarmac');
    const kerb = run('kerb');
    const grass = run('grass');
    expect(kerb).toBeGreaterThan(tarmac * 0.93);
    expect(grass).toBeLessThan(tarmac * 0.75);
  });

  it('reports the surface under the car and flags only grass', () => {
    const store = createGameStore();
    store.getState().configure({ driverId: 'norris', laps: 3, seed: 'kerb' });
    launch(store);
    const place = (lateral: number) => {
      const { point, tangent } = projectedTrack.at(0.3, lateral);
      store.setState({ car: createCarState(point.x, point.z, Math.atan2(tangent.z, tangent.x)), fraction: 0.3 });
      store.getState().step(1 / 60, COAST);
      return store.getState();
    };
    expect(place(0).surface).toBe('tarmac');
    const onKerb = place(7.4);
    expect(onKerb.surface).toBe('kerb');
    expect(onKerb.onTrack).toBe(true);
    const onGrass = place(8.5);
    expect(onGrass.surface).toBe('grass');
    expect(onGrass.onTrack).toBe(false);
  });
});

describe('walls', () => {
  const wall = 9;
  const projection = (lateral: number) => ({ fraction: 0.5, lateral, point: { x: 0, y: 0, z: 0 } as never, tangent: { x: 1, y: 0, z: 0 } as never });

  it('costs a glancing touch little and a square hit a lot', () => {
    const glancing = constrainToWalls({ x: 0, z: wall + 0.2, heading: 0.1, speed: 60 }, projection(wall + 0.2), wall);
    const square = constrainToWalls({ x: 0, z: wall + 0.2, heading: 1.2, speed: 60 }, projection(wall + 0.2), wall);
    expect(glancing.hitWall).toBe(true);
    expect(glancing.speed).toBeGreaterThan(45);
    expect(square.speed).toBeLessThan(30);
    // Both come out inside the wall line, not on it.
    expect(Math.abs(glancing.z)).toBeLessThan(wall);
  });

  it('slides along the wall instead of scrubbing to a halt while leaning on it', () => {
    let car = { x: 0, z: wall + 0.05, heading: 0.15, speed: 50 };
    let touching = false;
    for (let step = 0; step < 120; step += 1) {
      const result = constrainToWalls(car, projection(car.z), wall, touching);
      touching = result.hitWall;
      // Keep steering into the wall, as a player grinding it would.
      car = { x: result.x, z: wall + 0.05, heading: result.heading + 0.02, speed: result.speed };
    }
    expect(car.speed).toBeGreaterThan(20);
  });
});

describe('contact', () => {
  it('a rear-end hit drops the player to just under the other car, not to a stop', () => {
    const rival = { x: 4, z: 0, heading: 0, speed: 45 };
    const result = resolveCarContact({ x: 0, z: 0, heading: 0, speed: 70 }, [rival]);
    expect(result.contact).toBeGreaterThan(0);
    expect(result.speed).toBeGreaterThan(40);
    expect(result.speed).toBeLessThan(45);
  });
});

describe('keyboard steering', () => {
  it('ramps up to full lock over a third of a second and centres faster', () => {
    const listeners: Record<string, (event: KeyboardEvent) => void> = {};
    let now = 0;
    const fakeWindow = {
      addEventListener: (type: string, handler: (event: KeyboardEvent) => void) => { listeners[type] = handler; },
      removeEventListener: () => {},
      navigator: {},
    } as unknown as Window;
    const realNow = performance.now;
    performance.now = () => now;
    try {
      const input = createKeyboardInput(fakeWindow);
      input.read();
      // Frames every 16 ms, as the game reads it.
      const advance = (ms: number) => { let last = 0; for (let t = 16; t <= ms; t += 16) { now += 16; last = input.read().steer; } return last; };
      listeners.keydown({ code: 'KeyD', repeat: false, preventDefault() {} } as KeyboardEvent);
      const early = advance(96);
      expect(early).toBeGreaterThan(0.2);
      expect(early).toBeLessThan(0.5);
      expect(advance(320)).toBeCloseTo(1, 5);
      listeners.keyup({ code: 'KeyD' } as KeyboardEvent);
      expect(advance(64)).toBeLessThan(0.6);
      expect(advance(128)).toBe(0);
    } finally {
      performance.now = realNow;
    }
  });
});

describe('placement and restart', () => {
  it('bumps the placement counter on reset so the camera can snap', () => {
    const store = createGameStore();
    store.getState().configure({ driverId: 'norris', laps: 3, seed: 'place' });
    launch(store);
    const before = store.getState().placement;
    store.getState().resetToTrack();
    expect(store.getState().placement).toBe(before + 1);
  });

  it('pauses only during the race and freezes the clock', () => {
    const store = createGameStore();
    store.getState().configure({ driverId: 'norris', laps: 3, seed: 'pause' });
    store.getState().togglePause();
    expect(store.getState().paused).toBe(false);
    launch(store);
    store.getState().togglePause();
    const elapsed = store.getState().elapsed;
    store.getState().step(1, { ...COAST, throttle: 1 });
    expect(store.getState().elapsed).toBe(elapsed);
    store.getState().togglePause();
    store.getState().step(1, { ...COAST, throttle: 1 });
    expect(store.getState().elapsed).toBeGreaterThan(elapsed);
  });

  it('races a different field on restart', () => {
    const store = createGameStore();
    store.getState().configure({ driverId: 'norris', laps: 3, seed: 'first' });
    store.getState().restart();
    expect(store.getState().seed).not.toBe('first');
  });
});
