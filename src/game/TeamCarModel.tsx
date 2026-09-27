import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { Box3, DirectionalLight, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { ASSETS } from '../assets/asset-registry';
import { faceNoseForward } from '../scene/car-orientation';
import { cloneSceneWithOwnedMaterials } from '../scene/scene-resources';

const CAR_LENGTH_METRES = 5.6;

const cameraDirection = new Vector3();
const fillTarget = new Vector3();

/**
 * A light that rides with the chase camera. These models are authored as
 * metals, and the sun sits in front of the car, so the rear the player
 * actually sees would otherwise fall off to black. It stays on the default
 * layer: a light the camera cannot see is dropped before it shades anything.
 */
export function CarFillLights() {
  const fill = useRef<DirectionalLight>(null);
  useFrame(({ camera }) => {
    const light = fill.current;
    if (!light) return;
    camera.getWorldDirection(cameraDirection);
    light.position.copy(camera.position);
    fillTarget.copy(camera.position).addScaledVector(cameraDirection, 24);
    light.target.position.copy(fillTarget);
    light.target.updateMatrixWorld();
  });
  return <directionalLight ref={fill} color="#fff6ee" intensity={1.35} />;
}

/**
 * A team's car model, normalised to real size and sat on the ground.
 *
 * The supplied models are authored at three different scales, so each is
 * measured and scaled from its own bounds rather than trusting the file.
 */
export function TeamCarModel({
  teamId,
  detail = 'full',
  alwaysVisible = false,
  sunlit = false,
}: {
  teamId: string;
  detail?: 'full' | 'low';
  alwaysVisible?: boolean;
  sunlit?: boolean;
}) {
  const gltf = useGLTF(detail === 'low' ? ASSETS.teamCarLod(teamId) : ASSETS.teamCar(teamId));
  const resources = useMemo(() => {
    const cloned = cloneSceneWithOwnedMaterials(gltf.scene, (material) => {
      if (!(material instanceof MeshStandardMaterial)) return;
      // These paints are authored as near-perfect mirrors. In the race that
      // reflection is the grey road, so the livery disappears and the car reads
      // as a dark blob. Keep a little gloss and let the colour map show.
      material.roughness = Math.min(0.95, Math.max(sunlit ? 0.58 : 0.18, material.roughness));
      material.metalness = sunlit ? Math.min(material.metalness, 0.22) : material.metalness;
      material.envMapIntensity = sunlit ? 0.35 : 1.05;
      if (sunlit && 'specularIntensity' in material) {
        const physical = material as MeshStandardMaterial & { specularIntensity: number };
        physical.specularIntensity = Math.min(physical.specularIntensity, 0.15);
      }
      if (sunlit && 'clearcoat' in material) {
        const physical = material as MeshStandardMaterial & { clearcoat: number };
        physical.clearcoat = Math.min(physical.clearcoat, 0.15);
      }
      if (!material.transparent) return;
      // The race uses a logarithmic depth buffer. Transparent livery that skips
      // the depth write smears a second ghost of the car down the road.
      material.depthWrite = true;
      material.needsUpdate = true;
    });
    const object = cloned.scene;
    object.scale.set(1, 1, 1);
    object.position.set(0, 0, 0);
    object.rotation.set(0, 0, 0);
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
      if (child instanceof Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        child.frustumCulled = !(alwaysVisible || sunlit);
        child.geometry.computeBoundingBox();
        child.geometry.computeBoundingSphere();
      }
    });
    return cloned;
  }, [alwaysVisible, gltf.scene, sunlit]);
  useEffect(() => () => resources.dispose(), [resources]);
  useEffect(() => {
    resources.scene.traverse((child) => {
      if (child instanceof Mesh) child.frustumCulled = !(alwaysVisible || sunlit);
    });
  }, [resources, alwaysVisible, sunlit]);

  return <primitive object={resources.scene} dispose={null} />;
}
