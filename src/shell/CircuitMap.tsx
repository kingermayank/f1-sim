import type { Circuit, CornerNote } from '../content/circuits';

interface CircuitMapProps {
  circuit: Circuit;
  /** Corner currently highlighted, if any. */
  selectedCorner?: CornerNote;
  onSelectCorner?(corner: CornerNote): void;
  labelled?: boolean;
}

/**
 * Draws a circuit from the normalised outline that was traced from the
 * simulation's own centerline, so the browse map and the raced geometry are the
 * same shape. Corner markers are positioned by lap fraction along that outline.
 */
export function CircuitMap({ circuit, selectedCorner, onSelectCorner, labelled = false }: CircuitMapProps) {
  if (!circuit.outline) {
    return (
      <div className="circuit-map circuit-map--empty" role="img" aria-label={`${circuit.name} map not available yet`}>
        <span>Track model not built yet</span>
      </div>
    );
  }

  const points = outlinePoints(circuit.outline);

  return (
    <svg
      className="circuit-map"
      viewBox="-8 -8 116 116"
      role="img"
      aria-label={`${circuit.name} circuit map`}
    >
      <path d={circuit.outline} className="circuit-map__line" />
      {labelled && circuit.corners?.map((corner) => {
        const point = pointAtFraction(points, corner.distance);
        const active = selectedCorner?.label === corner.label;
        return (
          <g key={corner.label}>
            <circle
              cx={point.x}
              cy={point.y}
              r={active ? 4.4 : 3.2}
              className={active ? 'circuit-map__pin is-active' : 'circuit-map__pin'}
              tabIndex={0}
              role="button"
              aria-label={corner.label}
              aria-pressed={active}
              onClick={() => onSelectCorner?.(corner)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelectCorner?.(corner);
                }
              }}
            />
          </g>
        );
      })}
    </svg>
  );
}

interface Point { x: number; y: number }

function outlinePoints(outline: string): Point[] {
  return outline
    .split(/(?=[ML])/)
    .map((segment) => segment.trim().replace(/^[ML]/, '').trim())
    .filter((segment) => segment && segment !== 'Z')
    .map((segment) => {
      const [x, y] = segment.split(/\s+/).map(Number);
      return { x, y };
    })
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
}

/** Walks the outline by arc length so markers sit at the right lap fraction. */
function pointAtFraction(points: Point[], fraction: number): Point {
  if (points.length === 0) return { x: 50, y: 50 };
  const lengths: number[] = [];
  let total = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    lengths.push(length);
    total += length;
  }

  let target = ((fraction % 1) + 1) % 1 * total;
  for (let index = 0; index < points.length; index += 1) {
    if (target <= lengths[index]) {
      const a = points[index];
      const b = points[(index + 1) % points.length];
      const t = lengths[index] === 0 ? 0 : target / lengths[index];
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    target -= lengths[index];
  }
  return points[0];
}
