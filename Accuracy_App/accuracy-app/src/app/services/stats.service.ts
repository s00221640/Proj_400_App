import { Injectable } from '@angular/core';
import { DbService } from './db.services';

@Injectable({ providedIn: 'root' })
export class StatsService {
  constructor(private db: DbService) {}

  // Helper to compute aim bias direction
  private computeBiasDirection(shots: any[]): string | undefined {
    if (!shots.length) return undefined;
    const meanX = shots.reduce((a, s) => a + s.x, 0) / shots.length;
    const meanY = shots.reduce((a, s) => a + s.y, 0) / shots.length;
    // Assume target center is (0,0) or use calibration if available
    // For now, just use (0,0)
    if (Math.abs(meanX) < 5 && Math.abs(meanY) < 5) return "centered";
    if (Math.abs(meanX) > Math.abs(meanY)) return meanX > 0 ? "right" : "left";
    return meanY > 0 ? "low" : "high";
  }

  // returns { sessions: number, shots: number, avgScore: number, biasDirection?: string }
  async archerStats(archerId: string) {
    const sessions = await this.db.listSessionsByArcher(archerId);
    let shotsTotal = 0;
    let pointsTotal = 0;
    let allShots: any[] = [];
    for (const s of sessions) {
      const shots = await this.db.listShotsBySession(s.id);
      const archerShots = shots.filter(sh => sh.archerId === archerId);
      shotsTotal += archerShots.length;
      pointsTotal += archerShots.reduce((a, sh) => a + (sh.score ?? 0), 0);
      allShots.push(...archerShots);
    }
    return {
      sessions: sessions.length,
      shots: shotsTotal,
      avgScore: shotsTotal ? (pointsTotal / shotsTotal) : 0,
      biasDirection: this.computeBiasDirection(allShots)
    };
  }

  async trendForArcher(archerId: string): Promise<{ deltaPct: number } | null> {
    const sessions = await this.db.listSessionsByArcher(archerId);
    if (sessions.length < 3) return null; // Only require 3 sessions

    // Sort sessions by date (assuming createdAt or dateIso)
    sessions.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));

    // Compute avg score per session for this archer
    const avgs: number[] = [];
    for (const s of sessions) {
      const shots = await this.db.listShotsBySession(s.id);
      const archerShots = shots.filter(sh => sh.archerId === archerId);
      if (!archerShots.length) continue;
      const avg = archerShots.reduce((a, sh) => a + (sh.score ?? 0), 0) / archerShots.length;
      avgs.push(avg);
    }
    if (avgs.length < 3) return null;

    const last2 = avgs.slice(-2);
    const prev = avgs.slice(-3, -2);
    if (prev.length < 1) return null;

    const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
    const deltaPct = 100 * (mean(last2) - mean(prev)) / mean(prev);

    return { deltaPct };
  }
}