import { Material, Mesh, type Object3D } from 'three';

export interface OwnedSceneClone {
  scene: Object3D;
  dispose(): void;
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
