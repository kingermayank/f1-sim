import type { CarInput } from './car-physics';

/**
 * Player input from keyboard and gamepad, merged.
 *
 * Keyboard: WASD or arrows, Space brakes, Shift is DRS, R resets to the
 * track, Enter skips the intro, P or Escape pauses. Keys are polled every
 * frame rather than event-driven so held keys feel continuous. Because a key
 * is either down or up, keyboard steering is ramped: full lock takes a third
 * of a second to reach and the wheel centres faster than it turns, which is
 * the difference between a car you can place and one that darts.
 *
 * Gamepad (standard mapping): left stick steers, right trigger is throttle,
 * left trigger brake, A or RB is DRS, Y resets, Start skips the intro or
 * pauses. Any pad input takes precedence over the keys for that control.
 */
export interface InputController {
  read(): CarInput;
  consumeReset(): boolean;
  /** Enter (or Start) was pressed since the last call: skip the intro. */
  consumeSkip(): boolean;
  /** P, Escape (or Start during the race) was pressed since the last call. */
  consumePause(): boolean;
  /** True when a gamepad is connected, for the HUD's key legend. */
  hasGamepad(): boolean;
  dispose(): void;
}

/** Seconds to reach full lock from centre, and to centre from full lock. */
const STEER_IN_SECONDS = 0.32;
const STEER_OUT_SECONDS = 0.12;
const STICK_DEADZONE = 0.12;

export function createKeyboardInput(target: Window = window): InputController {
  const down = new Set<string>();
  let resetRequested = false;
  let skipRequested = false;
  let pauseRequested = false;
  let steer = 0;
  let lastRead = typeof performance === 'undefined' ? 0 : performance.now();
  // Edge detection for pad buttons.
  const padWasDown = new Map<number, boolean>();

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.repeat) return;
    down.add(event.code);
    if (event.code === 'KeyR') resetRequested = true;
    if (event.code === 'Enter' || event.code === 'NumpadEnter') skipRequested = true;
    if (event.code === 'KeyP' || event.code === 'Escape') pauseRequested = true;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) event.preventDefault();
  };
  const onKeyUp = (event: KeyboardEvent) => down.delete(event.code);
  const onBlur = () => down.clear();

  target.addEventListener('keydown', onKeyDown);
  target.addEventListener('keyup', onKeyUp);
  target.addEventListener('blur', onBlur);

  function pad(): Gamepad | null {
    const navigatorWithPads = target.navigator as Navigator | undefined;
    if (!navigatorWithPads || typeof navigatorWithPads.getGamepads !== 'function') return null;
    for (const candidate of navigatorWithPads.getGamepads()) {
      if (candidate && candidate.connected && candidate.mapping === 'standard') return candidate;
    }
    return null;
  }

  function padPressed(gamepad: Gamepad, index: number): boolean {
    const isDown = Boolean(gamepad.buttons[index]?.pressed);
    const was = padWasDown.get(index) ?? false;
    padWasDown.set(index, isDown);
    return isDown && !was;
  }

  return {
    read() {
      const now = typeof performance === 'undefined' ? lastRead : performance.now();
      const dt = Math.min(0.1, Math.max(0, (now - lastRead) / 1000));
      lastRead = now;

      const left = down.has('KeyA') || down.has('ArrowLeft') ? 1 : 0;
      const right = down.has('KeyD') || down.has('ArrowRight') ? 1 : 0;
      const target = right - left;
      // Ramp toward the key, faster back toward centre.
      const returning = target === 0 || (steer !== 0 && Math.sign(target) !== Math.sign(steer));
      const rate = returning ? 1 / STEER_OUT_SECONDS : 1 / STEER_IN_SECONDS;
      const delta = Math.max(-1, Math.min(1, target - steer));
      steer += Math.sign(delta) * Math.min(Math.abs(delta), rate * dt);

      let throttle = down.has('KeyW') || down.has('ArrowUp') ? 1 : 0;
      let brake = down.has('KeyS') || down.has('ArrowDown') || down.has('Space') ? 1 : 0;
      let drs = down.has('ShiftLeft') || down.has('ShiftRight');
      let steerOut = steer;

      const gamepad = pad();
      if (gamepad) {
        const stick = gamepad.axes[0] ?? 0;
        if (Math.abs(stick) > STICK_DEADZONE) {
          const scaled = (Math.abs(stick) - STICK_DEADZONE) / (1 - STICK_DEADZONE);
          // A gentle curve gives fine control near centre.
          steerOut = Math.sign(stick) * scaled ** 1.5;
        }
        const rightTrigger = gamepad.buttons[7]?.value ?? 0;
        const leftTrigger = gamepad.buttons[6]?.value ?? 0;
        if (rightTrigger > 0.02) throttle = rightTrigger;
        if (leftTrigger > 0.02) brake = leftTrigger;
        if (gamepad.buttons[0]?.pressed || gamepad.buttons[5]?.pressed) drs = true;
        if (padPressed(gamepad, 3)) resetRequested = true;
        if (padPressed(gamepad, 9)) { skipRequested = true; pauseRequested = true; }
      }

      return { throttle, brake, steer: Math.max(-1, Math.min(1, steerOut)), drs };
    },
    consumeReset() {
      const value = resetRequested;
      resetRequested = false;
      return value;
    },
    consumeSkip() {
      const value = skipRequested;
      skipRequested = false;
      return value;
    },
    consumePause() {
      const value = pauseRequested;
      pauseRequested = false;
      return value;
    },
    hasGamepad() {
      return pad() !== null;
    },
    dispose() {
      target.removeEventListener('keydown', onKeyDown);
      target.removeEventListener('keyup', onKeyUp);
      target.removeEventListener('blur', onBlur);
    },
  };
}
