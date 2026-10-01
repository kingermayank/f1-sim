import { useProgress } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import { Mesh } from 'three';

/**
 * Warm the scene through normal rendering behind the loading screen.
 * Do not call compile/compileAsync here: precompiling this live scene with
 * Three r185 reproduces invisible opaque car bodies (only decals survive).
 * A settled download counter alone is also insufficient: Suspense may not
 * have attached the player model yet.
 */
export function RaceReady({ onReady }: { onReady: () => void }) {
  const loading = useProgress((state) => state.active);
  const previousPlayer = useRef<object | null>(null);
  const ready = useRef(false);

  useFrame(({ scene }) => {
    if (ready.current) return;
    const player = scene.getObjectByName('player-car');
    let hasBody = false;
    player?.traverseVisible((object) => {
      if (!(object instanceof Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      if (materials.some((material) => material.visible && !material.transparent)) hasBody = true;
    });
    if (loading || !hasBody || !player) {
      previousPlayer.current = null;
      return;
    }
    // useFrame runs before drawing. Seeing the same loaded model on the next
    // frame means a normal render has run, including shadows and reflections.
    if (previousPlayer.current === player) {
      ready.current = true;
      onReady();
    }
    previousPlayer.current = player;
  });
  return null;
}
