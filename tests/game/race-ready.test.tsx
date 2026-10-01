import { act, render } from '@testing-library/react';
import { StrictMode } from 'react';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Scene } from 'three';
import { beforeEach, expect, it, vi } from 'vitest';
import { RaceReady } from '../../src/game/RaceReady';

const frame = vi.hoisted(() => ({
  active: false,
  callback: (_state: unknown) => {},
}));
vi.mock('@react-three/drei', () => ({
  useProgress: (select: (state: { active: boolean }) => unknown) => select({ active: frame.active }),
}));
vi.mock('@react-three/fiber', () => ({
  useFrame: (callback: typeof frame.callback) => { frame.callback = callback; },
}));

let scene: Scene;
let player: Group;
let onReady = vi.fn<() => void>();
const gl = { compile: vi.fn(), compileAsync: vi.fn() };
const tick = () => act(() => frame.callback({ scene, gl }));
const addBody = () => player.add(new Mesh(new BoxGeometry(), new MeshStandardMaterial()));
const view = () => <StrictMode><RaceReady onReady={onReady} /></StrictMode>;

beforeEach(() => {
  frame.active = false;
  scene = new Scene();
  player = new Group();
  player.name = 'player-car';
  scene.add(player);
  onReady = vi.fn();
  vi.clearAllMocks();
});

it('waits for an opaque model attachment and a normal frame, without precompiling', () => {
  render(view());
  tick();
  tick();
  expect(onReady).not.toHaveBeenCalled();
  const decal = new Mesh(new BoxGeometry(), new MeshStandardMaterial({ transparent: true }));
  player.add(decal);
  tick();
  tick();
  expect(onReady).not.toHaveBeenCalled();
  addBody();
  tick();
  expect(onReady).not.toHaveBeenCalled();
  tick();
  tick();
  expect(onReady).toHaveBeenCalledOnce();
  expect(gl.compile).not.toHaveBeenCalled();
  expect(gl.compileAsync).not.toHaveBeenCalled();
});

it('restarts the frame check if loading resumes', () => {
  addBody();
  const { rerender } = render(view());
  tick();
  frame.active = true;
  rerender(view());
  tick();
  tick();
  expect(onReady).not.toHaveBeenCalled();
  frame.active = false;
  rerender(view());
  tick();
  expect(onReady).not.toHaveBeenCalled();
  tick();
  expect(onReady).toHaveBeenCalledOnce();
});

it('does not accept a hidden body and starts fresh on each race mount', () => {
  addBody();
  player.visible = false;
  const first = render(view());
  tick();
  tick();
  expect(onReady).not.toHaveBeenCalled();
  player.visible = true;
  tick();
  tick();
  expect(onReady).toHaveBeenCalledOnce();
  first.unmount();
  render(view());
  tick();
  expect(onReady).toHaveBeenCalledOnce();
  tick();
  expect(onReady).toHaveBeenCalledTimes(2);
});
