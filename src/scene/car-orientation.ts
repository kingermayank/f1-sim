import { Box3, Mesh, Object3D, Quaternion, Vector3 } from 'three';

/**
 * Which way a supplied car model points.
 *
 * The seven Sketchfab cars come from seven authors and do not agree on a
 * forward axis: most have the nose at +Z, one has it at -Z. The scene expects
 * +Z. Rather than carry a per-team table that breaks the day a model is
 * swapped, the nose is found from the shape: a Formula 1 car's rear end is
 * tall (the rear wing) and its front end is low (nose and front wing). The
 * comparison uses a high percentile of vertex height over each end quarter,
 * so a stray tall vertex — one model has an antenna-like sliver at its nose —
 * cannot flip the answer.
 */
const END_FRACTION = 0.25;
const PERCENTILE = 0.9;
const MAX_SAMPLES_PER_MESH = 4000;

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

/**
 * Yaw (radians about Y) that turns the model so its nose faces +Z: 0 or π for
 * a model built along Z, ±π/2 for one built along X.
 */
export function noseCorrectionYaw(model: Object3D): number {
  model.updateMatrixWorld(true);
  const bounds = new Box3().setFromObject(model);
  const size = bounds.getSize(new Vector3());
  const alongX = size.x > size.z;
  const min = alongX ? bounds.min.x : bounds.min.z;
  const length = alongX ? size.x : size.z;
  if (!Number.isFinite(length) || length <= 0) return 0;

  const low: number[] = [];
  const high: number[] = [];
  const point = new Vector3();
  model.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const position = object.geometry.getAttribute('position');
    if (!position) return;
    const step = Math.max(1, Math.floor(position.count / MAX_SAMPLES_PER_MESH));
    for (let index = 0; index < position.count; index += step) {
      point.fromBufferAttribute(position, index).applyMatrix4(object.matrixWorld);
      const along = ((alongX ? point.x : point.z) - min) / length;
      if (along < END_FRACTION) low.push(point.y);
      else if (along > 1 - END_FRACTION) high.push(point.y);
    }
  });

  // The taller end is the rear, so the nose is at the other end of the axis.
  const noseAtMax = percentile(high, PERCENTILE) < percentile(low, PERCENTILE);
  if (!alongX) return noseAtMax ? 0 : Math.PI;
  // Rotating about Y by -π/2 carries +X onto +Z.
  return noseAtMax ? -Math.PI / 2 : Math.PI / 2;
}

const WORLD_UP = new Vector3(0, 1, 0);

/**
 * Turns the model about world up so its nose faces +Z, keeping whatever
 * rotation its root already carries (some models need it to stand upright).
 * The model must not be attached to a rotated parent when this is called.
 */
export function faceNoseForward(model: Object3D): void {
  const yaw = noseCorrectionYaw(model);
  if (yaw === 0) return;
  model.quaternion.premultiply(new Quaternion().setFromAxisAngle(WORLD_UP, yaw));
  model.updateMatrixWorld(true);
}
