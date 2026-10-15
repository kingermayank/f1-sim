import { Environment as SkyLight, useTexture } from '@react-three/drei';
import { useMemo } from 'react';
import { EquirectangularReflectionMapping, SRGBColorSpace } from 'three';
import { ASSETS } from '../assets/asset-registry';

/**
 * The haze at the horizon of the circuit's sky, for fog that melts into it.
 * Measured from the rendered sky (scripts/circuit/render_sky.py prints it).
 */
export const HORIZON_HAZE = '#b6c1c5';

/**
 * The sky over the circuit, rendered in Blender (scripts/circuit/render_sky.py):
 * a physically based atmosphere with fair-weather cumulus, its sun exactly
 * where the game's sun light shines from. It is both the visible background
 * and the light the cars' paint and the glass reflect, so they always agree.
 */
export function CircuitSky({ intensity = 0.85 }: { intensity?: number }) {
  const texture = useTexture(ASSETS.sky);
  const sky = useMemo(() => {
    texture.mapping = EquirectangularReflectionMapping;
    texture.colorSpace = SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }, [texture]);
  return <SkyLight map={sky} background environmentIntensity={intensity} />;
}
