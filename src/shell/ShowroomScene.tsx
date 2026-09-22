import { ContactShadows, OrbitControls, useGLTF } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import { Suspense, useEffect, useMemo, useRef } from 'react';
import { Color, Group } from 'three';
import { ASSETS } from '../assets/asset-registry';
import { TEAMS_2026 } from '../domain/grid-2026';
import { TeamCarModel } from '../game/TeamCarModel';

/**
 * The showroom: one car on a turntable under a key light, with a rim light in
 * the team's colour. Drag to spin it; it drifts on its own otherwise. A car
 * change scales the new one up from slightly small so the swap reads as a
 * reveal rather than a pop.
 */
function Turntable({ teamId }: { teamId: string }) {
  const group = useRef<Group>(null);
  const reveal = useRef(0);
  useEffect(() => { reveal.current = 0; }, [teamId]);
  useFrame((_, delta) => {
    const object = group.current;
    if (!object) return;
    reveal.current = Math.min(1, reveal.current + delta * 2.2);
    const eased = 1 - (1 - reveal.current) ** 3;
    const scale = 0.88 + 0.12 * eased;
    object.scale.setScalar(scale);
    // A last quarter-turn settles into the resting pose as it lands.
    object.rotation.y = (1 - eased) * 0.6;
  });
  return (
    <group ref={group}>
      <Suspense fallback={null}><TeamCarModel teamId={teamId} /></Suspense>
    </group>
  );
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

export function ShowroomScene({ teamId }: { teamId: string }) {
  const team = TEAMS_2026.find((candidate) => candidate.id === teamId) ?? TEAMS_2026[0];
  return (
    <Canvas
      className="showroom__canvas"
      shadows
      dpr={[1, 1.5]}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      camera={{ position: [7.4, 2.3, 7.2], fov: 30, near: 0.1, far: 100 }}
    >
      <Lights accent={team.color} />
      <Turntable teamId={teamId} />
      <ContactShadows position={[0, 0.005, 0]} opacity={0.75} scale={14} blur={2.2} far={3} color="#000000" />
      <mesh position={[0, -0.002, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[7, 64]} />
        <meshStandardMaterial color="#0d1117" roughness={0.35} metalness={0.4} />
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
  for (const team of TEAMS_2026) useGLTF.preload(ASSETS.teamCar(team.id));
}
