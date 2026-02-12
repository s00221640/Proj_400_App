export type BowType = 'recurve' | 'compound' | 'barebow' | 'longbow';

export interface ArcherProfile {
  id: string;
  name: string;
  bowType?: BowType;
  avatarUrl?: string;
  createdAt: number;
  updatedAt: number;
  handedness?: string;
  eyeDominance?: string;
}

export interface Calibration {
  centerX: number;
  centerY: number;
  ringRadiusPx: number;
}

export interface SessionMeta {
  id: string;
  archerId: string; // legacy, keep for back-compat
  dateIso: string;
  roundName?: string;
  distanceMeters?: number;
  targetFace?: string;
  createdAt: number;
  updatedAt: number;
  photoPath?: string;
  calibration?: {
    centerX: number;
    centerY: number;
    ringRadiusPx: number;
  };
  arrowsPerEnd?: number;

  // New fields for multi-archer support:
  ownerArcherId?: string;
  participants: { archerId: string; displayName: string; }[];
  calibrations?: Record<string, Calibration>;
}

export interface Shot {
  id: string;
  sessionId: string;
  x: number;
  y: number;
  order?: number;
  score?: number;
  createdAt: number;
  endIndex?: number;
  archerId?: string; // <-- new, optional for back-compat
}

export interface Metrics {
  sessionId: string;
  meanRadialError: number;
  groupSizeR95: number;
  biasAngleDeg: number;
  biasDistance: number;
  computedAt: number;
}
