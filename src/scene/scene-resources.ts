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
    dispose() {
      scene.removeFromParent();
      for (const material of ownedMaterials) material.dispose();
      ownedMaterials.clear();
    },
  };
}
