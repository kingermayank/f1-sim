/**
 * AudioWorklet processor for the engines: two output channels, the player's
 * car on 0 and the nearest rival on 1. Loaded by `engine-audio.ts` through
 * Vite's `?worker&url`, which bundles this file and its imports into one
 * script for the build and serves it as an ES module in development.
 */
import { ENGINE_PROCESSOR, EngineVoices, type EngineMessage } from './engine-voices';

/** The parts of AudioWorkletGlobalScope used here (the DOM lib does not describe that scope). */
interface WorkletScope {
  sampleRate: number;
  AudioWorkletProcessor: new () => { readonly port: MessagePort };
  registerProcessor(name: string, processor: unknown): void;
}

const scope = globalThis as unknown as WorkletScope;

class EngineProcessor extends scope.AudioWorkletProcessor {
  private readonly voices = new EngineVoices(scope.sampleRate);

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<EngineMessage>) => this.voices.handle(event.data);
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const channels = outputs[0];
    if (channels && channels[0]) this.voices.render(channels[0], channels[1]);
    return !this.voices.stopped;
  }
}

scope.registerProcessor(ENGINE_PROCESSOR, EngineProcessor);
