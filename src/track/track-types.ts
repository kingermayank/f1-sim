import type { Quaternion, Vector3 } from 'three';

export interface TrackPoint {
  x: number;
  y: number;
  z: number;
}

export interface TrackZone {
  start: number;
  end: number;
  kind: 'passing' | 'yellow' | 'speed-limit';
}

export interface CameraAnchor {
  id: string;
  /** Human-readable shot name, shown when the director cuts to this camera. */
  name: string;
  distance: number;
  position: TrackPoint;
  targetOffset: TrackPoint;
}

export interface TrackDefinition {
  id: string;
  lengthMeters: number;
  centerLine: TrackPoint[];
  attackLine: TrackPoint[];
  defendLine: TrackPoint[];
  pitLine: TrackPoint[];
  pitEntry: number;
  pitExit: number;
  sectors: [number, number, number];
  gridSlots: { distance: number; lateral: number }[];
  zones: TrackZone[];
  cameraAnchors: CameraAnchor[];
}

export interface TrackTransform {
  position: Vector3;
  rotation: Quaternion;
  tangent: Vector3;
}

export interface SplineTrack {
  sample(distance: number, lateral: number, line?: 'center' | 'attack' | 'defend' | 'pit'): TrackTransform;
}
