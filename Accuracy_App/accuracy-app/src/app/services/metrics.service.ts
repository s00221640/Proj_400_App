import { Injectable } from '@angular/core';
import { Metrics, Shot, Calibration } from '../models';

@Injectable({ providedIn: 'root' })
export class MetricsService {
  compute(sessionId: string, shots: Shot[], cal?: Calibration): Metrics {
    if (!shots.length) {
      return { sessionId, meanRadialError: 0, groupSizeR95: 0, biasAngleDeg: 0, biasDistance: 0, computedAt: Date.now() };
    }
    const cx = cal?.centerX ?? 0;
    const cy = cal?.centerY ?? 0;

    const meanX = shots.reduce((a, s) => a + s.x, 0) / shots.length;
    const meanY = shots.reduce((a, s) => a + s.y, 0) / shots.length;

    const dists = shots.map(s => Math.hypot(s.x - cx, s.y - cy));
    const meanRadialError = dists.reduce((a, d) => a + d, 0) / shots.length;

    const biasDx = meanX - cx;
    const biasDy = meanY - cy;
    const biasDistance = Math.hypot(biasDx, biasDy);
    const biasAngleDeg = (Math.atan2(biasDy, biasDx) * 180) / Math.PI;

    const mean = meanRadialError;
    const variance = dists.reduce((a, d) => a + (d - mean) ** 2, 0) / Math.max(1, shots.length - 1);
    const stddev = Math.sqrt(variance);
    const groupSizeR95 = 2 * stddev;

    return { sessionId, meanRadialError, groupSizeR95, biasAngleDeg, biasDistance, computedAt: Date.now() };
  }
}
