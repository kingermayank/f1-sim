import type { CarInput } from './car-physics';

/**
 * Keyboard state for the player car. WASD or arrows; Shift for DRS; R resets to
 * the track. Polled every frame rather than event-driven so held keys feel
 * continuous.
 */
export interface InputController {
  read(): CarInput;
  consumeReset(): boolean;
  /** Enter was pressed since the last call: skip the intro. */
  consumeSkip(): boolean;
  dispose(): void;
}

export function createKeyboardInput(target: Window = window): InputController {
  const down = new Set<string>();
  let resetRequested = false;
  let skipRequested = false;

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.repeat) return;
    down.add(event.code);
    if (event.code === 'KeyR') resetRequested = true;
    if (event.code === 'Enter' || event.code === 'NumpadEnter') skipRequested = true;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) event.preventDefault();
  };
  const onKeyUp = (event: KeyboardEvent) => down.delete(event.code);
  const onBlur = () => down.clear();

  target.addEventListener('keydown', onKeyDown);
  target.addEventListener('keyup', onKeyUp);
  target.addEventListener('blur', onBlur);

  return {
    read() {
      const throttle = down.has('KeyW') || down.has('ArrowUp') ? 1 : 0;
      const brake = down.has('KeyS') || down.has('ArrowDown') || down.has('Space') ? 1 : 0;
      const left = down.has('KeyA') || down.has('ArrowLeft') ? 1 : 0;
      const right = down.has('KeyD') || down.has('ArrowRight') ? 1 : 0;
      const drs = down.has('ShiftLeft') || down.has('ShiftRight');
      return { throttle, brake, steer: right - left, drs };
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
    dispose() {
      target.removeEventListener('keydown', onKeyDown);
      target.removeEventListener('keyup', onKeyUp);
      target.removeEventListener('blur', onBlur);
    },
  };
}
