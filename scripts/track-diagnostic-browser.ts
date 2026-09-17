import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

import type { TrackDefinition, TrackPoint } from '../src/track/track-types';

declare global {
  interface Window {
    __diagnosticReady?: boolean;
    __diagnosticError?: string;
  }
}

const parameters = new URLSearchParams(location.search);
const id = parameters.get('circuit');
const view = parameters.get('view') ?? 'overhead';
const overlayDepthTest = view !== 'overhead';
if (!id || !/^[a-z0-9-]+$/u.test(id)) throw new Error('Missing or invalid circuit ID');

const module = await import(/* @vite-ignore */ `/src/track/generated/${id}-track.ts`);
const track = Object.values(module).find((value): value is TrackDefinition => (
  Boolean(value) && typeof value === 'object' && (value as TrackDefinition).id === id
));
if (!track) throw new Error(`Track definition export not found for ${id}`);

document.querySelector('#title')!.textContent = `${id} · ${view.replaceAll('-', ' ')} · ${overlayDepthTest ? 'depth-tested' : 'overview overlay'}`;

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.shadowMap.enabled = true;
document.body.append(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#071018');
scene.fog = view === 'overhead' ? null : new THREE.FogExp2('#071018', 0.00042);
scene.add(new THREE.HemisphereLight('#d8edff', '#26331f', 2.2));
const sun = new THREE.DirectionalLight('#fff1d3', 3.5);
sun.position.set(800, 1500, 500);
sun.castShadow = true;
scene.add(sun);

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const gltf = await loader.loadAsync(`/assets/models/tracks/${id}.glb`);
gltf.scene.traverse((object) => {
  if (!(object instanceof THREE.Mesh)) return;
  object.receiveShadow = true;
  object.castShadow = false;
  const materials = Array.isArray(object.material) ? object.material : [object.material];
  for (const material of materials) {
    material.depthWrite = true;
    material.needsUpdate = true;
  }
});
scene.add(gltf.scene);

const toVector = (point: TrackPoint, lift = 0) => new THREE.Vector3(point.x, point.y + lift, point.z);
function line(points: readonly TrackPoint[], color: string, lift: number, opacity = 1): THREE.Line {
  const geometry = new THREE.BufferGeometry().setFromPoints(points.map((point) => toVector(point, lift)));
  const material = new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity, depthTest: overlayDepthTest });
  const result = new THREE.Line(geometry, material);
  result.renderOrder = 10;
  return result;
}

scene.add(line(track.centerLine, '#10e7ff', 1.3));
scene.add(line(track.attackLine, '#8279ff', 1.18, 0.94));
scene.add(line(track.defendLine, '#ffb43f', 1.16, 0.94));
scene.add(line(track.pitLine, '#ff3cba', 1.55));

const loop = track.centerLine.slice(0, -1);
function sample(fraction: number): { point: THREE.Vector3; tangent: THREE.Vector3; normal: THREE.Vector3 } {
  const scaled = (((fraction % 1) + 1) % 1) * loop.length;
  const index = Math.floor(scaled) % loop.length;
  const nextIndex = (index + 1) % loop.length;
  const amount = scaled - Math.floor(scaled);
  const point = toVector(loop[index]).lerp(toVector(loop[nextIndex]), amount);
  const previous = toVector(loop[(index - 2 + loop.length) % loop.length]);
  const next = toVector(loop[(index + 2) % loop.length]);
  const tangent = next.sub(previous).normalize();
  const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
  return { point, tangent, normal };
}

const markerMaterial = new THREE.MeshBasicMaterial({ color: '#ffe055', depthTest: overlayDepthTest });
for (const slot of track.gridSlots) {
  const { point, tangent, normal } = sample(slot.distance);
  const marker = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.55, 5.1), markerMaterial);
  marker.position.copy(point).addScaledVector(normal, slot.lateral);
  marker.position.y += 1.65;
  marker.rotation.y = Math.atan2(tangent.x, tangent.z);
  marker.renderOrder = 12;
  scene.add(marker);
}

const sectorMaterial = new THREE.MeshBasicMaterial({ color: '#ff6d43', depthTest: overlayDepthTest });
for (const boundary of track.sectors) {
  const { point } = sample(boundary % 1);
  const marker = new THREE.Mesh(new THREE.SphereGeometry(5.2, 16, 12), sectorMaterial);
  marker.position.copy(point);
  marker.position.y += 6;
  marker.renderOrder = 12;
  scene.add(marker);
}

const cameraMaterial = new THREE.MeshBasicMaterial({ color: '#8bff70', depthTest: overlayDepthTest });
for (const anchor of track.cameraAnchors) {
  const marker = new THREE.Mesh(new THREE.ConeGeometry(5, 13, 10), cameraMaterial);
  marker.position.copy(toVector(anchor.position));
  marker.renderOrder = 12;
  scene.add(marker);
  const target = sample(anchor.distance).point;
  const ray = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([marker.position, target]),
    new THREE.LineBasicMaterial({ color: '#8bff70', transparent: true, opacity: 0.52, depthTest: overlayDepthTest }),
  );
  ray.renderOrder = 11;
  scene.add(ray);
}

const trackBox = new THREE.Box3().setFromPoints(loop.map((point) => toVector(point)));
const center = trackBox.getCenter(new THREE.Vector3());
const size = trackBox.getSize(new THREE.Vector3());
const span = Math.max(size.x, size.z);
const camera = new THREE.PerspectiveCamera(view === 'overhead' ? 34 : 48, innerWidth / innerHeight, 0.5, 20_000);

if (view === 'overhead') {
  camera.position.set(center.x, center.y + span * 1.76, center.z);
  camera.up.set(0, 0, -1);
  camera.lookAt(center);
} else {
  const trackLevelAnchors = track.cameraAnchors.filter((anchor) => anchor.id !== 'birds-eye');
  const preferredAnchorIds: Record<string, [string, string]> = {
    suzuka: ['turns-1-2', 'back-straight'],
    melbourne: ['pit-straight', 'lakeside'],
    barcelona: ['pit-straight', 'campsa'],
    spa: ['pit-straight', 'raidillon'],
    silverstone: ['hamilton-straight', 'hangar-straight'],
    singapore: ['pit-straight', 'bayfront-drone'],
    'red-bull-ring': ['pit-straight', 'remus'],
    austin: ['pit-straight', 'turn-1'],
    'abu-dhabi': ['pit-straight', 'hotel'],
  };
  const preferredId = preferredAnchorIds[id]?.[view === 'track-level-1' ? 0 : 1];
  const anchor = trackLevelAnchors.find((candidate) => candidate.id === preferredId)
    ?? (view === 'track-level-1'
      ? trackLevelAnchors[0]
      : trackLevelAnchors[Math.min(6, trackLevelAnchors.length - 1)]);
  const target = sample(anchor.distance).point.add(new THREE.Vector3(
    anchor.targetOffset.x,
    anchor.targetOffset.y,
    anchor.targetOffset.z,
  ));
  camera.position.copy(toVector(anchor.position));
  camera.lookAt(target);
}

renderer.render(scene, camera);
await new Promise<void>((accept) => requestAnimationFrame(() => requestAnimationFrame(() => accept())));
renderer.render(scene, camera);
window.__diagnosticReady = true;
