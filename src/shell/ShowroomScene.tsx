import { ContactShadows, OrbitControls, useGLTF } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Color, Group } from 'three';
import { ASSETS } from '../assets/asset-registry';
import { TEAMS_2026 } from '../domain/grid-2026';
import { TeamCarModel } from '../game/TeamCarModel';

/**
 * The showroom: one car on a fixed stage under a key light, with a rim light
 * in the team's colour. Dragging and the idle orbit remain continuous. A team
 * change swaps models at the same angle without moving either vehicle.
 */
const SWAP_SECONDS = 0.3;

function CarSwap({ teamId }: { teamId: string }) {
  const current = useRef<Group>(null);
  const departing = useRef<Group>(null);
  const displayedTeam = useRef(teamId);
  const visibleTeam = useRef(teamId);
  const [leavingTeam, setLeavingTeam] = useState<string | null>(null);
  const progress = useRef(1);
  const reducedMotion = useRef(false);

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => { reducedMotion.current = preference.matches; };
    update();
    preference.addEventListener('change', update);
    return () => preference.removeEventListener('change', update);
  }, []);

  useLayoutEffect(() => {
    if (displayedTeam.current === teamId) return;
    setLeavingTeam(reducedMotion.current ? null : visibleTeam.current);
    displayedTeam.current = teamId;
    progress.current = reducedMotion.current ? 1 : 0;
  }, [teamId]);

  useFrame((_, delta) => {
    const next = current.current;
    if (!next) return;
    if (progress.current >= 1) {
      next.visible = true;
      visibleTeam.current = teamId;
      return;
    }
    progress.current = Math.min(1, progress.current + Math.min(delta, 0.1) / SWAP_SECONDS);
    const showNext = progress.current >= 0.5;
    next.visible = showNext;
    visibleTeam.current = showNext ? teamId : leavingTeam ?? teamId;
    if (departing.current) departing.current.visible = !showNext;
    if (progress.current === 1) setLeavingTeam(null);
  });
  return (
    <>
      {leavingTeam && (
        <group ref={departing}>
          <Suspense fallback={null}><TeamCarModel teamId={leavingTeam} /></Suspense>
        </group>
      )}
      <group ref={current}>
        <Suspense fallback={null}><TeamCarModel teamId={teamId} /></Suspense>
      </group>
    </>
  );
}

/** A portrait phone sees a narrower slice of the room, so the camera backs off to keep the whole car in frame. */
function FrameForAspect() {
  const camera = useThree((state) => state.camera);
  const aspect = useThree((state) => state.size.width / state.size.height);
  useEffect(() => {
    const distance = Math.max(1, Math.min(2.1, 1.35 / aspect));
    camera.position.set(7.4 * distance, 2.3 * distance, 7.2 * distance);
    camera.updateProjectionMatrix();
  }, [camera, aspect]);
  return null;
}

function Lights({ accent }: { accent: string }) {
  const rim = useMemo(() => new Color(accent), [accent]);
  return (
    <>
      <hemisphereLight args={['#dbe6f2', '#0a0d12', 1.1]} />
      <spotLight position={[4, 9, 5]} angle={0.55} penumbra={0.7} intensity={900} color="#fff4e0" castShadow shadow-mapSize={[1024, 1024]} shadow-bias={-0.0002} />
      <spotLight position={[-6, 6, 4]} angle={0.6} penumbra={0.9} intensity={260} color="#e8f0ff" />
      <spotLight position={[-7, 4, -6]} angle={0.6} penumbra={0.9} intensity={420} color={rim} />
      <pointLight position={[0, 1.2, -6]} intensity={40} color={rim} />
    </>
  );
}

export function ShowroomScene({ teamId, lite = false }: { teamId: string; lite?: boolean }) {
  const team = TEAMS_2026.find((candidate) => candidate.id === teamId) ?? TEAMS_2026[0];
  return (
    <Canvas
      className="showroom__canvas"
      shadows={!lite}
      dpr={lite ? 1 : [1, 1.5]}
      gl={{ antialias: !lite, alpha: true, powerPreference: 'high-performance' }}
      camera={{ position: [7.4, 2.3, 7.2], fov: 30, near: 0.1, far: 100 }}
    >
      <FrameForAspect />
      <Lights accent={team.color} />
      <CarSwap teamId={teamId} />
      <ContactShadows position={[0, 0.018, 0]} opacity={0.92} scale={10} blur={1.35} far={3.5} color="#000000" />
      <mesh position={[0, -0.095, 0]} receiveShadow castShadow>
        <cylinderGeometry args={[5.95, 6.12, 0.18, 96]} />
        <meshStandardMaterial color="#070a0f" roughness={0.5} metalness={0.65} />
      </mesh>
      <mesh position={[0, 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[5.94, 96]} />
        <meshStandardMaterial color="#111822" roughness={0.3} metalness={0.62} />
      </mesh>
      <mesh position={[0, 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[5.72, 5.94, 96]} />
        <meshBasicMaterial color={team.color} transparent opacity={0.18} />
      </mesh>
      <OrbitControls
        target={[0, -0.1, 0]}
        enableZoom={false}
        enablePan={false}
        autoRotate
        autoRotateSpeed={0.9}
        minPolarAngle={Math.PI / 3.2}
        maxPolarAngle={Math.PI / 2.05}
      />
    </Canvas>
  );
}

/** Warm every team model so flipping through the field never waits on a download. */
export function preloadShowroom() {
  for (const team of TEAMS_2026) {
    useGLTF.preload(ASSETS.teamCar(team.id));
    useGLTF.preload(ASSETS.teamCarLod(team.id));
  }
}
