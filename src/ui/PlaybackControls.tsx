import { CAMERA_MODES, PLAYBACK_SPEEDS, useRaceStore, type CameraMode, type QualityMode } from '../store/race-store';
import { titleCase } from './formatters';

function ControlIcon({ children }: { children: React.ReactNode }) {
  return <span className="control-icon" aria-hidden="true">{children}</span>;
}

export function PlaybackControls({ onOpenCredits }: { onOpenCredits(): void }) {
  const snapshot = useRaceStore((state) => state.snapshot);
  const isPaused = useRaceStore((state) => state.isPaused);
  const speed = useRaceStore((state) => state.speed);
  const cameraMode = useRaceStore((state) => state.cameraMode);
  const labelsEnabled = useRaceStore((state) => state.labelsEnabled);
  const effectsEnabled = useRaceStore((state) => state.effectsEnabled);
  const audioMuted = useRaceStore((state) => state.audioMuted);
  const reducedMotion = useRaceStore((state) => state.reducedMotion);
  const qualityMode = useRaceStore((state) => state.qualityMode);
  const togglePause = useRaceStore((state) => state.togglePause);
  const setSpeed = useRaceStore((state) => state.setSpeed);
  const setCameraMode = useRaceStore((state) => state.setCameraMode);
  const restart = useRaceStore((state) => state.restart);
  const replaySeed = useRaceStore((state) => state.replaySeed);
  const toggleLabels = useRaceStore((state) => state.toggleLabels);
  const toggleEffects = useRaceStore((state) => state.toggleEffects);
  const toggleAudio = useRaceStore((state) => state.toggleAudio);
  const toggleReducedMotion = useRaceStore((state) => state.toggleReducedMotion);
  const setQualityMode = useRaceStore((state) => state.setQualityMode);

  const confirmRestart = (action: () => void) => {
    const activePastLapOne = snapshot.phase === 'racing' && snapshot.cars.some((car) => car.lap > 1);
    if (!activePastLapOne || window.confirm('Restart this active race? Current progress will be lost.')) action();
  };

  return (
    <nav className="playback-controls" aria-label="Race playback controls">
      <div className="playback-controls__primary">
        <button type="button" className="control control--primary" onClick={togglePause} aria-label={isPaused ? 'Resume race' : 'Pause race'} aria-pressed={isPaused}>
          <ControlIcon>{isPaused ? '▶' : 'Ⅱ'}</ControlIcon><span>{isPaused ? 'Resume' : 'Pause'}</span>
        </button>
        <label className="control-select"><span>Speed</span><select aria-label="Simulation speed" value={speed} onChange={(event) => setSpeed(Number(event.target.value) as typeof speed)}>{PLAYBACK_SPEEDS.map((value) => <option key={value} value={value}>{value}×</option>)}</select></label>
        <button type="button" className="control" onClick={() => confirmRestart(() => restart(snapshot.seed))} aria-label="Restart race"><ControlIcon>↺</ControlIcon><span>Restart</span></button>
        <button type="button" className="control" onClick={() => confirmRestart(replaySeed)} aria-label="Replay seed"><ControlIcon>⟲</ControlIcon><span>Replay</span></button>
        <button type="button" className="control" onClick={() => confirmRestart(() => restart())} aria-label="New race seed"><ControlIcon>✦</ControlIcon><span>New seed</span></button>
      </div>

      <fieldset className="camera-controls"><legend>Camera</legend>{CAMERA_MODES.map((mode) => <button key={mode} type="button" aria-label={`${titleCase(mode)} camera`} aria-pressed={cameraMode === mode} onClick={() => setCameraMode(mode as CameraMode)}>{titleCase(mode)}</button>)}</fieldset>

      <div className="preference-controls" aria-label="Presentation preferences">
        <button type="button" aria-label={labelsEnabled ? 'Hide car labels' : 'Show car labels'} aria-pressed={labelsEnabled} onClick={toggleLabels}>Labels</button>
        <button type="button" aria-label={effectsEnabled ? 'Disable race effects' : 'Enable race effects'} aria-pressed={effectsEnabled} onClick={toggleEffects}>FX</button>
        <button type="button" aria-label={audioMuted ? 'Unmute audio' : 'Mute audio'} aria-pressed={audioMuted} onClick={toggleAudio}>{audioMuted ? 'Muted' : 'Audio'}</button>
        <button type="button" aria-label={reducedMotion ? 'Disable reduced motion' : 'Enable reduced motion'} aria-pressed={reducedMotion} onClick={toggleReducedMotion}>Motion</button>
        <label className="quality-control"><span>Quality</span><select aria-label="Scene detail" value={qualityMode} onChange={(event) => setQualityMode(event.target.value as QualityMode)}><option value="auto">Auto</option><option value="high">High</option><option value="mobile">Low</option></select></label>
        <button type="button" aria-label="Open credits and disclosure from controls" onClick={onOpenCredits}>Credits</button>
      </div>
    </nav>
  );
}
