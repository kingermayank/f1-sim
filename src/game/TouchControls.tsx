import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { gameStore, useGameStore } from './game-store';
import { getPlayerInput, type TouchInput } from './input';

/**
 * On-screen controls for phones and tablets: steer on the left thumb,
 * throttle and brake on the right, DRS above the throttle. Multi-touch aware
 * — each control tracks its own pointer so a thumb on the throttle does not
 * release the steering. Shown only on coarse-pointer devices.
 */
export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(() => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches);
  useEffect(() => {
    const query = window.matchMedia('(pointer: coarse)');
    const update = () => setCoarse(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return coarse;
}

type Control = 'left' | 'right' | 'throttle' | 'brake' | 'drs';

export function TouchControls() {
  const phase = useGameStore((state) => state.phase);
  const drsAvailable = useGameStore((state) => state.drsAvailable);
  const held = useRef<Map<number, Control>>(new Map());
  const [active, setActive] = useState<Set<Control>>(new Set());

  const publish = () => {
    const controls = new Set(held.current.values());
    setActive(controls);
    const input: TouchInput = {
      steer: (controls.has('right') ? 1 : 0) - (controls.has('left') ? 1 : 0),
      throttle: controls.has('throttle') ? 1 : 0,
      brake: controls.has('brake') ? 1 : 0,
      drs: controls.has('drs'),
    };
    getPlayerInput().setTouch(controls.size ? input : null);
  };

  const press = (control: Control) => (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    // Capture so a thumb sliding off the button still releases it; some browsers throw for a pointer that has already gone.
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* fine without capture */ }
    held.current.set(event.pointerId, control);
    publish();
  };
  const release = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    held.current.delete(event.pointerId);
    publish();
  };

  useEffect(() => () => getPlayerInput().setTouch(null), []);

  if (phase === 'intro') {
    return (
      <div className="touch touch--intro">
        <button type="button" className="touch__skip" onClick={() => gameStore.getState().skipIntro()}>Skip intro</button>
      </div>
    );
  }
  if (phase === 'finished') return null;

  const cls = (control: Control, extra = '') => `touch__btn touch__btn--${control}${active.has(control) ? ' is-held' : ''}${extra}`;

  return (
    <div className="touch" aria-label="Touch controls">
      <div className="touch__cluster touch__cluster--left">
        <button type="button" className={cls('left')} onPointerDown={press('left')} onPointerUp={release} onPointerCancel={release} aria-label="Steer left">‹</button>
        <button type="button" className={cls('right')} onPointerDown={press('right')} onPointerUp={release} onPointerCancel={release} aria-label="Steer right">›</button>
      </div>
      <div className="touch__cluster touch__cluster--right">
        <button
          type="button"
          className={cls('drs', drsAvailable ? ' is-available' : '')}
          onPointerDown={press('drs')} onPointerUp={release} onPointerCancel={release}
          aria-label="DRS"
        >DRS</button>
        <button type="button" className={cls('brake')} onPointerDown={press('brake')} onPointerUp={release} onPointerCancel={release} aria-label="Brake">Brake</button>
        <button type="button" className={cls('throttle')} onPointerDown={press('throttle')} onPointerUp={release} onPointerCancel={release} aria-label="Throttle">Go</button>
      </div>
      <div className="touch__aux">
        <button type="button" onClick={() => getPlayerInput().requestReset()} aria-label="Reset to track">R</button>
        <button type="button" onClick={() => getPlayerInput().requestPause()} aria-label="Pause">II</button>
      </div>
    </div>
  );
}
