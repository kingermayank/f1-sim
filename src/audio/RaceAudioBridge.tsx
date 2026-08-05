import { useEffect, useRef } from 'react';
import { raceStore, useRaceStore } from '../store/race-store';
import { raceAudioController } from './race-audio';

export function RaceAudioBridge() {
  const snapshot = useRaceStore((state) => state.snapshot);
  const selectedDriverId = useRaceStore((state) => state.selectedDriverId);
  const audioMuted = useRaceStore((state) => state.audioMuted);
  const eventCursor = useRef({ seed: snapshot.seed, count: 0 });

  useEffect(() => {
    raceAudioController.setMuted(audioMuted);
  }, [audioMuted]);

  useEffect(() => {
    raceAudioController.update(snapshot, selectedDriverId);
    if (eventCursor.current.seed !== snapshot.seed || snapshot.events.length < eventCursor.current.count) {
      eventCursor.current = { seed: snapshot.seed, count: 0 };
    }
    raceAudioController.handleEvents(snapshot.events.slice(eventCursor.current.count));
    eventCursor.current.count = snapshot.events.length;
  }, [selectedDriverId, snapshot]);

  useEffect(() => {
    const resumeAfterInteraction = () => {
      if (!raceStore.getState().audioMuted) void raceAudioController.resume();
    };
    window.addEventListener('pointerdown', resumeAfterInteraction, { passive: true });
    window.addEventListener('keydown', resumeAfterInteraction);
    return () => {
      window.removeEventListener('pointerdown', resumeAfterInteraction);
      window.removeEventListener('keydown', resumeAfterInteraction);
    };
  }, []);

  useEffect(() => () => { void raceAudioController.dispose(); }, []);
  return null;
}
