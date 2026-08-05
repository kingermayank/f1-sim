import { DRIVERS_2026 } from '../domain/grid-2026';
import type { RaceState } from '../simulation/events';
import { MONACO_TRACK } from '../track/monaco-track';

const points = MONACO_TRACK.centerLine;
const bounds = points.reduce((result, point) => ({
  minX: Math.min(result.minX, point.x), maxX: Math.max(result.maxX, point.x),
  minZ: Math.min(result.minZ, point.z), maxZ: Math.max(result.maxZ, point.z),
}), { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });
const project = (x: number, z: number) => ({
  x: 10 + ((x - bounds.minX) / (bounds.maxX - bounds.minX)) * 180,
  y: 10 + ((z - bounds.minZ) / (bounds.maxZ - bounds.minZ)) * 180,
});
const path = `${points.map((point, index) => {
  const p = project(point.x, point.z);
  return `${index === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
}).join(' ')} Z`;

export function TrackMap({ snapshot, selectedDriverId }: {
  snapshot: Readonly<RaceState>;
  selectedDriverId: string | null;
}) {
  return (
    <section className="track-map" aria-label="Track map">
      <header className="panel-kicker"><span>Position map</span><span>Monte Carlo</span></header>
      <svg viewBox="0 0 200 200" role="img" aria-label="Monaco circuit position map">
        <path className="track-map__shadow" d={path} />
        <path className="track-map__line" d={path} />
        <line className="track-map__finish" x1="128" x2="139" y1="113" y2="119" />
        {snapshot.cars.map((car) => {
          const point = points[Math.floor((((car.distance % 1) + 1) % 1) * points.length) % points.length];
          const position = project(point.x, point.z);
          const driver = DRIVERS_2026.find((item) => item.id === car.driverId)!;
          return <circle key={car.driverId} data-testid="track-map-marker" cx={position.x} cy={position.y} r={selectedDriverId === car.driverId ? 4.2 : 2.6} fill={driver.color} className={selectedDriverId === car.driverId ? 'is-selected' : ''} />;
        })}
      </svg>
      <ol className="visually-hidden" aria-label="Driver track positions">
        {snapshot.cars.map((car) => {
          const driver = DRIVERS_2026.find((item) => item.id === car.driverId)!;
          return <li key={car.driverId}>{driver.name}, lap {Math.max(1, car.lap + 1)}, {Math.round(car.distance * 100)} percent around the circuit</li>;
        })}
      </ol>
    </section>
  );
}
