import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { Box3, DirectionalLight, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { ASSETS } from '../assets/asset-registry';
import { faceNoseForward } from '../scene/car-orientation';
import { cloneSceneWithOwnedMaterials } from '../scene/scene-resources';

const CAR_LENGTH_METRES = 5.6;
/** Cars also sit on this layer so a fill light can reach them without lifting the circuit. */
const CAR_LIGHT_LAYER = 1;

const cameraDirection = new Vector3();
const fillTarget = new Vector3();

/**
 * Extra light that only hits the cars. The circuit is lit by the sun and
 * hemisphere alone; these models are authored as metals and specular paint, so
 * the chase view would otherwise lose the livery on the rear bodywork.
 */
export function CarFillLights() {
  const fill = useRef<DirectionalLight>(null);
  useEffect(() => {
    const light = fill.current;
    if (!light) return;
    light.layers.disable(0);
    light.layers.enable(CAR_LIGHT_LAYER);
    light.target.layers.disable(0);
    light.target.layers.enable(CAR_LIGHT_LAYER);
  }, []);
  useFrame(({ camera }) => {
    const light = fill.current;
    if (!light) return;
    camera.getWorldDirection(cameraDirection);
    light.position.copy(camera.position);
    fillTarget.copy(camera.position).addScaledVector(cameraDirection, 24);
    light.target.position.copy(fillTarget);
    light.target.updateMatrixWorld();
  });
  return (
    <>
      <hemisphereLight
        args={['#e8f2fa', '#3a4044', 1.7]}
        ref={(light) => {
          if (!light) return;
          light.layers.disable(0);
          light.layers.enable(CAR_LIGHT_LAYER);
        }}
      />
      <directionalLight ref={fill} color="#fff4e8" intensity={1.15} />
    </>
  );
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
      material.roughness = Math.min(0.95, Math.max(0.18, material.roughness));
      material.envMapIntensity = 0.85;
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
        if (sunlit) child.layers.enable(CAR_LIGHT_LAYER);
        child.geometry.computeBoundingBox();
        child.geometry.computeBoundingSphere();
      }
    });
    return cloned;
  }, [gltf.scene, sunlit]);
  useEffect(() => () => resources.dispose(), [resources]);
  useEffect(() => {
    resources.scene.traverse((child) => {
      if (child instanceof Mesh) child.frustumCulled = !alwaysVisible;
    });
  }, [resources, alwaysVisible]);

  return <primitive object={resources.scene} dispose={null} />;
}
