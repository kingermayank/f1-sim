/**
 * Reproducibly creates the project-original fallback assets used by the demo.
 * No third-party geometry, logos, or texture pixels are included.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import {
  BoxGeometry,
  CatmullRomCurve3,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  TubeGeometry,
  Vector3,
} from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

// GLTFExporter is browser-oriented; this minimal adapter lets its binary branch
// run in Node while keeping the exported artifacts identical to browser GLBs.
globalThis.FileReader ??= class FileReader {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((result) => {
      this.result = result;
      this.onloadend?.();
    }).catch((error) => this.onerror?.(error));
  }
};

const publicRoot = resolve('public/assets');
const modelRoot = `${publicRoot}/models`;
const textureRoot = `${publicRoot}/textures/teams`;
const sourceRoot = resolve('work/assets-source');

for (const path of [modelRoot, textureRoot, sourceRoot]) mkdirSync(path, { recursive: true });

const material = (color, roughness = 0.65, metalness = 0.05) => new MeshStandardMaterial({ color, roughness, metalness });
const add = (parent, geometry, color, position, scale, rotation = [0, 0, 0]) => {
  const mesh = new Mesh(geometry, material(color));
  mesh.position.set(...position);
  mesh.scale.set(...scale);
  mesh.rotation.set(...rotation);
  parent.add(mesh);
  return mesh;
};

async function exportGlb(scene, fileName) {
  const exporter = new GLTFExporter();
  const binary = await new Promise((resolveExport, reject) => {
    exporter.parse(scene, resolveExport, reject, { binary: true, onlyVisible: true });
  });
  writeFileSync(`${modelRoot}/${fileName}`, Buffer.from(binary));
}

function createTrack() {
  const track = new Group();
  track.name = 'Project Original Monaco-inspired Harbor Circuit';
  const points = [
    [-18, 0, 2], [-15, 0, -8], [-8, 0, -15], [2, 0, -17], [16, 0, -11],
    [19, 0, 1], [12, 0, 13], [2, 0, 18], [-9, 0, 15], [-17, 0, 9],
  ].map(([x, y, z]) => new Vector3(x, y, z));
  const curve = new CatmullRomCurve3(points, true, 'centripetal');
  const asphalt = new TubeGeometry(curve, 96, 2.4, 6, true);
  track.add(new Mesh(asphalt, material('#2d3238', 0.92)));
  const edge = new TubeGeometry(curve, 96, 2.62, 6, true);
  const edgeMesh = new Mesh(edge, material('#e8e6df', 0.72));
  edgeMesh.position.y = -0.035;
  track.add(edgeMesh);
  const water = new Mesh(new CylinderGeometry(30, 30, 0.18, 10), material('#167e9e', 0.3, 0.2));
  water.position.set(6, -0.32, 8);
  water.scale.set(1, 1, 0.75);
  track.add(water);
  for (let index = 0; index < 18; index += 1) {
    const angle = (index / 18) * Math.PI * 2;
    const radius = index % 2 === 0 ? 25 : 22;
    add(track, new BoxGeometry(1, 1, 1), index % 3 === 0 ? '#e5cfa7' : '#f2eee2',
      [Math.cos(angle) * radius, 1.5 + (index % 4), Math.sin(angle) * radius],
      [2 + (index % 3), 3 + (index % 5), 2 + ((index + 1) % 3)], [0, angle, 0]);
  }
  return track;
}

function createCar() {
  const car = new Group();
  car.name = 'Project Original Low-poly Open-wheel Race Car';
  const carbon = '#11161a';
  const body = '#e8e8e2';
  add(car, new BoxGeometry(1.4, 0.36, 3.5), body, [0, 0.45, 0], [1, 1, 1]);
  add(car, new SphereGeometry(0.48, 10, 6), body, [0, 0.63, -0.22], [0.85, 0.7, 1.25]);
  add(car, new BoxGeometry(2.35, 0.12, 0.5), carbon, [0, 0.42, -1.72], [1, 1, 1]);
  add(car, new BoxGeometry(1.95, 0.1, 0.28), carbon, [0, 0.88, 1.55], [1, 1, 1]);
  add(car, new BoxGeometry(0.1, 0.62, 0.22), carbon, [-0.72, 0.64, 1.52], [1, 1, 1]);
  add(car, new BoxGeometry(0.1, 0.62, 0.22), carbon, [0.72, 0.64, 1.52], [1, 1, 1]);
  const wheelGeometry = new CylinderGeometry(0.46, 0.46, 0.28, 10);
  for (const [x, z] of [[-0.92, -1.05], [0.92, -1.05], [-0.92, 1.05], [0.92, 1.05]]) {
    add(car, wheelGeometry, carbon, [x, 0.44, z], [1, 1, 1], [Math.PI / 2, 0, 0]);
  }
  return car;
}

const teams = [
  ['mercedes', '#00A19C', '#C8CCCE', '63 12'], ['ferrari', '#E80020', '#FFF200', '16 44'],
  ['mclaren', '#FF8000', '#47C7FC', '1 81'], ['red-bull', '#3671C6', '#FCD700', '3 6'],
  ['racing-bulls', '#6692FF', '#FFFFFF', '30 41'], ['alpine', '#FF87BC', '#2293D1', '10 43'],
  ['haas', '#B6BABD', '#E6002D', '31 87'], ['audi', '#F50537', '#B7FF00', '27 5'],
  ['williams', '#1868DB', '#00A0DE', '55 23'], ['aston-martin', '#229971', '#CEDC00', '14 18'],
  ['cadillac', '#C8A96B', '#111111', '11 77'],
];

function createLiverySvg(team, base, accent, numbers, index) {
  const rotation = 14 + index * 7;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${base}"/>
  <path d="M-70 120 L390 -50 L580 70 L80 250 Z" fill="${accent}" opacity=".95"/>
  <path d="M-90 430 L420 180 L600 300 L70 560 Z" fill="#111820" opacity=".86"/>
  <path d="M0 255 L512 100" stroke="#fff" stroke-opacity=".5" stroke-width="9"/>
  <g transform="rotate(${rotation} 256 256)"><rect x="158" y="92" width="196" height="328" rx="42" fill="#0b1014" opacity=".88"/>
  <path d="M180 146 H332" stroke="${accent}" stroke-width="18"/><path d="M180 366 H332" stroke="${accent}" stroke-width="18"/></g>
  <text x="256" y="286" text-anchor="middle" fill="#fff" font-family="Arial, sans-serif" font-size="60" font-weight="700" letter-spacing="4">${numbers}</text>
  <text x="256" y="472" text-anchor="middle" fill="#fff" font-family="Arial, sans-serif" font-size="18" font-weight="700" letter-spacing="5">${team.toUpperCase()}</text>
  </svg>`;
}

async function writeLiveryTextures() {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    if (!process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) throw error;
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    });
  }
  const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
  try {
    for (const [index, [team, base, accent, numbers]] of teams.entries()) {
      const svg = createLiverySvg(team, base, accent, numbers, index);
      writeFileSync(`${sourceRoot}/${team}-livery.svg`, svg);
      await page.setContent(`<style>html,body{margin:0;overflow:hidden}</style>${svg}`);
      await page.locator('svg').screenshot({ path: `${textureRoot}/${team}.webp`, type: 'webp', quality: 82 });
    }
  } finally {
    await browser.close();
  }
}

await exportGlb(createTrack(), 'monaco-track.glb');
await exportGlb(createCar(), 'f1-car.glb');
await writeLiveryTextures();

writeFileSync(`${sourceRoot}/PROJECT-ORIGINAL-ASSETS.md`, `# Project-original assets\n\nThe models and livery artwork are original procedural works authored for this repository.\nThey are dedicated to CC0 1.0 on 2026-08-04.\n\nThe runtime files are reproducibly generated by \`scripts/generate-race-assets.mjs\`.\nNo external archive, commercial model, logo, or copied texture is present.\n`);
