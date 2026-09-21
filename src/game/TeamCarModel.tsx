import { useGLTF } from '@react-three/drei';
import { useEffect, useMemo } from 'react';
import { Box3, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { ASSETS } from '../assets/asset-registry';
import { faceNoseForward } from '../scene/car-orientation';
import { cloneSceneWithOwnedMaterials } from '../scene/scene-resources';

const CAR_LENGTH_METRES = 5.6;

/**
 * A team's car model, normalised to real size and sat on the ground.
 *
 * The supplied models are authored at three different scales, so each is
 * measured and scaled from its own bounds rather than trusting the file.
 */
export function TeamCarModel({ teamId }: { teamId: string }) {
  const gltf = useGLTF(ASSETS.teamCar(teamId));
  const resources = useMemo(() => cloneSceneWithOwnedMaterials(gltf.scene, (material) => {
    if (!(material instanceof MeshStandardMaterial)) return;
    material.roughness = Math.min(0.95, Math.max(0.18, material.roughness));
    material.envMapIntensity = 0.85;
  }), [gltf.scene]);
  useEffect(() => () => resources.dispose(), [resources]);

  const scene = useMemo(() => {
    const object = resources.scene;
    object.scale.set(1, 1, 1);
    object.position.set(0, 0, 0);
    const size = new Box3().setFromObject(object).getSize(new Vector3());
    const length = Math.max(size.x, size.z) || 1;
    object.scale.setScalar(CAR_LENGTH_METRES / length);
    // Turn the model so its nose faces +Z before centring, since the centre
    // is measured after the turn. Added to the root's own rotation, which
    // some models rely on to stand upright.
    faceNoseForward(object);
    const scaled = new Box3().setFromObject(object);
    const centre = scaled.getCenter(new Vector3());
    object.position.set(-centre.x, -scaled.min.y, -centre.z);
    object.traverse((child) => {
      if (child instanceof Mesh) { child.castShadow = true; child.receiveShadow = true; }
    });
    return object;
  }, [resources]);

  return <primitive object={scene} dispose={null} />;
}
