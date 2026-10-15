/**
 * The two engines the race needs: the player's car from the onboard camera,
 * and the nearest rival heard from outside. Shared by the AudioWorklet and by
 * the ScriptProcessor fallback, so both speak the same messages.
 */
import { EngineDsp, type EngineDspInput } from './engine-dsp';

/** The name the worklet registers its processor under. */
export const ENGINE_PROCESSOR = 'f1-engine';

export type EngineMessage =
  | { type: 'player'; input: EngineDspInput }
  /** Null when no rival is close: its engine runs on briefly while the graph fades it, then rests. */
  | { type: 'rival'; input: EngineDspInput | null }
  | { type: 'stop' };

/** Seconds the rival engine keeps running after it is dropped, while its gain fades. */
const RIVAL_TAIL_SECONDS = 0.6;

export class EngineVoices {
  private readonly player: EngineDsp;
  private readonly rival: EngineDsp;
  private rivalActive = false;
  private rivalTail = 0;
  private readonly tailSamples: number;
  stopped = false;

  constructor(sampleRate: number) {
    this.player = new EngineDsp(sampleRate, { perspective: 'onboard', seed: 1 });
    this.rival = new EngineDsp(sampleRate, { perspective: 'exterior', seed: 7 });
    this.tailSamples = Math.round(sampleRate * RIVAL_TAIL_SECONDS);
  }

  handle(message: EngineMessage): void {
    if (message.type === 'player') this.player.setInput(message.input);
    else if (message.type === 'rival') {
      if (message.input) {
        this.rival.setInput(message.input);
        this.rivalActive = true;
        this.rivalTail = this.tailSamples;
      } else {
        this.rivalActive = false;
      }
    } else if (message.type === 'stop') this.stopped = true;
  }

  /** Player into `player`, rival into `rival` (silence while it rests). */
  render(player: Float32Array, rival: Float32Array | undefined): void {
    this.player.process(player, 0, player.length);
    if (!rival) return;
    if (this.rivalActive || this.rivalTail > 0) {
      this.rival.process(rival, 0, rival.length);
      if (!this.rivalActive) this.rivalTail = Math.max(0, this.rivalTail - rival.length);
    } else {
      rival.fill(0);
    }
  }
}
