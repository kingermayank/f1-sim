import { Material, Mesh, Texture, type Object3D } from 'three';

export interface OwnedSceneClone {
  scene: Object3D;
  dispose(): void;
}

/**
 * Maps that GLTF materials carry. `Material.clone()` keeps the same Texture
 * objects, and those stay bound to the WebGL context that first drew them.
 * Leaving the showroom therefore leaves the race with dead uploads — the cars
 * draw as black shells until each map is marked to upload again.
 */
const TEXTURE_KEYS = [
  'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap',
  'alphaMap', 'bumpMap', 'displacementMap', 'envMap', 'lightMap',
  'specularColorMap', 'specularIntensityMap', 'clearcoatMap', 'clearcoatNormalMap',
  'clearcoatRoughnessMap', 'sheenColorMap', 'sheenRoughnessMap', 'transmissionMap',
  'thicknessMap', 'anisotropyMap', 'iridescenceMap', 'iridescenceThicknessMap',
] as const;

function rebindMaps(material: Material) {
  for (const key of TEXTURE_KEYS) {
    const texture = (material as Material & Record<string, unknown>)[key];
    if (texture instanceof Texture) texture.needsUpdate = true;
  }
}

export function cloneSceneWithOwnedMaterials(
  source: Object3D,
  configureMaterial?: (material: Material, mesh: Mesh) => void,
): OwnedSceneClone {
  const scene = source.clone(true);
  const ownedMaterials = new Set<Material>();

  scene.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material];
    const clonedMaterials = sourceMaterials.map((sourceMaterial) => {
      const clonedMaterial = sourceMaterial.clone();
      rebindMaps(clonedMaterial);
      ownedMaterials.add(clonedMaterial);
      configureMaterial?.(clonedMaterial, object);
      return clonedMaterial;
    });
    object.material = Array.isArray(object.material) ? clonedMaterials : clonedMaterials[0];
  });

  return {
    scene,
    /**
     * Frees the materials this clone owns. It deliberately does NOT detach the
     * object: `<primitive>` owns attachment, and React StrictMode runs effects
     * mount -> cleanup -> mount. Detaching here left the clone orphaned after
     * the second mount, so the model stayed in memory with correct transforms
     * but was never rendered.
     */
    dispose() {
      for (const material of ownedMaterials) material.dispose();
      ownedMaterials.clear();
    },
  };
}
