import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { HalfFloatType, Vector2, WebGLRenderTarget } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

export interface PostFXHandle {
  composer: EffectComposer;
  bloom: UnrealBloomPass | null;
}

/**
 * The showroom's image chain: the scene into a 4× multisampled half-float
 * target, ground-contact ambient occlusion, a gentle bloom that only catches
 * what is well past white (the LED strips, the paint shell), never the paint's
 * own highlights, then tone mapping and sRGB. Taking a frame from R3F (priority 1) replaces its default render.
 */
export function PostFX({ ao = true, bloom = true, bloomStrength = 0.2, onReady }: { ao?: boolean; bloom?: boolean; bloomStrength?: number; onReady?(handle: PostFXHandle): void }) {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const dpr = useThree((state) => state.viewport.dpr);

  const handle = useMemo<PostFXHandle>(() => {
    const target = new WebGLRenderTarget(2, 2, { type: HalfFloatType, samples: 4 });
    const composer = new EffectComposer(gl, target);
    composer.addPass(new RenderPass(scene, camera));
    if (ao) {
      const gtao = new GTAOPass(scene, camera, 2, 2);
      gtao.output = GTAOPass.OUTPUT.Default;
      gtao.blendIntensity = 0.85;
      gtao.updateGtaoMaterial({ radius: 0.5, distanceExponent: 1.4, thickness: 0.6, scale: 1.15, samples: 12, distanceFallOff: 1 });
      gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 6, normalPhi: 6, radius: 8, rings: 2, samples: 16 });
      composer.addPass(gtao);
    }
    const bloomPass = bloom ? new UnrealBloomPass(new Vector2(2, 2), bloomStrength, 0.2, 1.6) : null;
    if (bloomPass) composer.addPass(bloomPass);
    composer.addPass(new OutputPass());
    return { composer, bloom: bloomPass };
  }, [gl, scene, camera, ao, bloom, bloomStrength]);

  useEffect(() => {
    handle.composer.setPixelRatio(dpr);
    handle.composer.setSize(size.width, size.height);
  }, [handle, size.width, size.height, dpr]);

  useEffect(() => {
    onReady?.(handle);
  }, [handle, onReady]);

  useEffect(() => () => {
    for (const pass of handle.composer.passes) (pass as { dispose?: () => void }).dispose?.();
    handle.composer.renderTarget1.dispose();
    handle.composer.renderTarget2.dispose();
  }, [handle]);

  useFrame((_, delta) => {
    handle.composer.render(delta);
  }, 1);

  return null;
}
