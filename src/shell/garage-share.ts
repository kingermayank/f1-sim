import { DRIVERS_2026 } from '../domain/grid-2026';
import { FINISHES, type Livery } from '../car/liveries';
import type { PictureAngle } from './ShowroomScene';

/**
 * What a garage link carries: the driver (and so the car and livery), the
 * tyre compound, the wing mode and the picture angle. Readable on purpose:
 * `#/?d=leclerc&t=soft&w=corner&a=front`.
 */
export interface GarageState {
  driverId: string;
  compound: 'soft' | 'medium' | 'hard';
  straight: boolean;
  angle: PictureAngle;
}

const COMPOUNDS = ['soft', 'medium', 'hard'] as const;
const ANGLES = ['front', 'side', 'rear', 'above'] as const;

export function encodeGarage(state: GarageState): string {
  const params = new URLSearchParams({
    d: state.driverId,
    t: state.compound,
    w: state.straight ? 'straight' : 'corner',
    a: state.angle,
  });
  return `#/?${params.toString()}`;
}

/** Reads a shared car from the hash, ignoring anything unknown. */
export function decodeGarage(params: URLSearchParams): Partial<GarageState> {
  const state: Partial<GarageState> = {};
  const driver = params.get('d');
  if (driver && DRIVERS_2026.some((candidate) => candidate.id === driver)) state.driverId = driver;
  const compound = params.get('t');
  if (compound && (COMPOUNDS as readonly string[]).includes(compound)) state.compound = compound as GarageState['compound'];
  const wing = params.get('w');
  if (wing === 'straight' || wing === 'corner') state.straight = wing === 'straight';
  const angle = params.get('a');
  if (angle && (ANGLES as readonly string[]).includes(angle)) state.angle = angle as PictureAngle;
  return state;
}

export function garageUrl(state: GarageState): string {
  if (typeof window === 'undefined') return encodeGarage(state);
  const { origin, pathname, search } = window.location;
  return `${origin}${pathname}${search}${encodeGarage(state)}`;
}

export interface PictureInfo {
  driverName: string;
  driverCode: string;
  number: number;
  teamName: string;
  carName: string;
  livery: Livery;
}

const FINISH_NAMES: Record<keyof typeof FINISHES, string> = {
  gloss: 'Gloss', satin: 'Satin', matte: 'Matte', metallic: 'Metallic', pearl: 'Pearl',
};

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

/**
 * Lays the driver's details over a clean render: a dark scrim on the left
 * with the number, name and car, a colour card with the livery's three
 * colours, and the APEX mark. Sizes scale with the picture height.
 */
export function composePicture(render: HTMLCanvasElement, info: PictureInfo): HTMLCanvasElement {
  const width = render.width;
  const height = render.height;
  const k = height / 1080;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d')!;
  context.drawImage(render, 0, 0);

  const scrim = context.createLinearGradient(0, 0, width * 0.55, 0);
  scrim.addColorStop(0, 'rgba(7, 10, 18, 0.8)');
  scrim.addColorStop(1, 'rgba(7, 10, 18, 0)');
  context.fillStyle = scrim;
  context.fillRect(0, 0, width * 0.55, height);

  const wide = '"Formula1 Wide", "Formula1 Display", "Arial Black", sans-serif';
  const body = '"Formula1 Display", Inter, Arial, sans-serif';
  const mono = 'MonoSpec, ui-monospace, Menlo, monospace';
  const left = 70 * k;

  context.textBaseline = 'alphabetic';
  context.fillStyle = info.livery.primary;
  context.font = `500 ${24 * k}px ${mono}`;
  context.fillText(`${info.teamName}  ·  ${info.carName}`.toUpperCase(), left, 112 * k);

  context.font = `800 ${150 * k}px ${wide}`;
  context.fillStyle = info.livery.primary;
  context.shadowColor = 'rgba(0, 0, 0, 0.45)';
  context.shadowBlur = 30 * k;
  context.fillText(String(info.number), left - 6 * k, 262 * k);
  context.shadowBlur = 0;

  const [first, ...rest] = info.driverName.split(/\s+/);
  context.fillStyle = '#f2f5fb';
  context.font = `800 ${58 * k}px ${wide}`;
  context.fillText(first.toUpperCase(), left, 340 * k);
  context.fillText(rest.join(' ').toUpperCase(), left, 404 * k);

  context.fillStyle = '#aeb7cc';
  context.font = `500 ${26 * k}px ${mono}`;
  context.fillText(`${info.driverCode}  ·  ${info.livery.name}  ·  ${FINISH_NAMES[info.livery.finish]}`, left, 456 * k);

  // Colour card, bottom left.
  const cardX = 48 * k;
  const cardY = height - 300 * k;
  roundedRect(context, cardX, cardY, 250 * k, 236 * k, 20 * k);
  context.fillStyle = 'rgba(7, 10, 18, 0.66)';
  context.fill();
  const swatches: [string, string][] = [['Primary', info.livery.primary], ['Secondary', info.livery.secondary], ['Accent', info.livery.accent]];
  swatches.forEach(([name, hex], index) => {
    const y = cardY + 24 * k + index * 68 * k;
    roundedRect(context, cardX + 22 * k, y, 44 * k, 44 * k, 10 * k);
    context.fillStyle = hex;
    context.fill();
    context.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    context.lineWidth = 1.5 * k;
    context.stroke();
    context.fillStyle = '#f2f5fb';
    context.font = `600 ${22 * k}px ${body}`;
    context.fillText(name, cardX + 82 * k, y + 19 * k);
    context.fillStyle = '#8f99b6';
    context.font = `500 ${18 * k}px ${mono}`;
    context.fillText(hex.toUpperCase(), cardX + 82 * k, y + 42 * k);
  });

  // The mark, bottom right.
  context.textAlign = 'right';
  context.fillStyle = '#f2f5fb';
  context.font = `800 ${40 * k}px ${wide}`;
  context.fillText('APEX', width - 64 * k, height - 92 * k);
  context.fillStyle = '#8f99b6';
  context.font = `500 ${19 * k}px ${mono}`;
  context.fillText('2026 grid · pick your car, race the field', width - 64 * k, height - 58 * k);
  context.textAlign = 'left';
  return canvas;
}

export function canvasBlob(canvas: HTMLCanvasElement, type = 'image/png', quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), type, quality));
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function pictureFilename(info: PictureInfo): string {
  const slug = info.teamName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `apex-${slug}-${info.number}.png`;
}
