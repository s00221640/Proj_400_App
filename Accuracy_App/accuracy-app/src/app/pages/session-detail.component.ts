import { Component, ElementRef, ViewChild, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { ActivatedRoute } from '@angular/router';
import { DbService } from '../services/db.services';
import { MetricsService } from '../services/metrics.service';
import { Metrics, SessionMeta, Shot, Calibration } from '../models';
import { v4 as uuid } from 'uuid';

type Mode = 'calibrate-center' | 'calibrate-ring' | 'mark-shots';

type FeedbackResult = {
  title: string;
  pattern: string;
  userContext: string;
  likelyCauses: string[];
  corrections: string[];
  trainingFocus: string;
  trendNote: string;
};

@Component({
  selector: 'app-session-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  template: `
  <section style="max-width:1000px;margin:16px auto;padding:12px;display:grid;gap:12px">
    <a [routerLink]="['/profiles']" style="display:inline-block;margin-bottom:16px;color:#1976d2;text-decoration:underline;font-weight:500;">
      ← Back to Profiles
    </a>

    <header>
      <h2 style="margin:0">Session</h2>
      <div *ngIf="session() as s" style="color:#555">
        {{s.roundName || '—'}} • {{s.distanceMeters || '—'}}m • {{s.targetFace || '—'}}
      </div>
    </header>

    <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center">
      <label style="display:inline-block">
        <input type="file" accept="image/*" (change)="onFile($event)" hidden>
        <span style="padding:8px 12px;border:1px solid #ddd;border-radius:8px;cursor:pointer">Upload target photo</span>
      </label>

      <button (click)="setMode('calibrate-center')" [disabled]="mode() === 'calibrate-center'">Set centre</button>
      <button (click)="setMode('calibrate-ring')" [disabled]="!hasCenter() || mode() === 'calibrate-ring'">Set ring point</button>
      <button (click)="setMode('mark-shots')" [disabled]="!isCalibrated() || mode() === 'mark-shots'">Mark shots</button>
      <button (click)="undo()" [disabled]="shots().length===0">Undo</button>
      <button (click)="clearShots()" [disabled]="shots().length===0">Clear shots</button>
      <button (click)="exportSession()" [disabled]="!session()">Export JSON</button>

      <label style="display:inline-block">
        <input type="file" accept="application/json" (change)="importSession($event)" hidden>
        <span style="padding:6px 10px;border:1px solid #ddd;border-radius:6px;cursor:pointer">Import JSON</span>
      </label>
    </div>

    <small style="color:#666">
      Tip: When choosing the ring point, I’ll auto-snap to the nearest ring edge. Calibration is saved automatically.
    </small>

    <div style="display:grid;grid-template-columns:1fr 340px;gap:16px">
      <div style="overflow:auto;border:1px solid #eee;border-radius:8px;padding:8px">
        <canvas #cnv (click)="onCanvasClick($event)" style="max-width:100%;display:block;cursor:crosshair"></canvas>
      </div>

      <aside style="display:grid;gap:12px;align-content:start">
        <div style="border:1px solid #eee;border-radius:8px;padding:10px">
          <div style="font-weight:600;margin-bottom:6px">Calibration</div>
          <div>Centre: {{getCalForActiveArcher()?.centerX ?? '—'}}, {{getCalForActiveArcher()?.centerY ?? '—'}}</div>
          <div>Ring radius (px): {{getCalForActiveArcher()?.ringRadiusPx ?? '—'}}</div>
        </div>

        <div style="border:1px solid #eee;border-radius:8px;padding:10px">
          <div style="font-weight:600;margin-bottom:6px">Shots ({{shotsForActiveArcher().length}})</div>
          <ng-container *ngFor="let end of endIndices()">
            <details [open]="end === currentEnd()">
              <summary>
                End {{end + 1}}
                <span style="margin-left:8px;color:#888">
                  Total: {{endTotal(end)}} • Avg: {{endAvg(end) | number:'1.1-1'}}
                </span>
                <button (click)="clearEnd(end); $event.stopPropagation()">Clear end</button>
                <button (click)="deleteEnd(end); $event.stopPropagation()">Delete end</button>
              </summary>

              <ul style="list-style:none;padding:0;margin:0;max-height:240px;overflow:auto">
                <li *ngFor="let sh of shotsForEnd(end); let i = index" style="border-bottom:1px solid #f0f0f0;padding:6px 0">
                  #{{sh.order ?? i+1}} • ({{sh.x|number:'1.0-0'}}, {{sh.y|number:'1.0-0'}}) • <strong>{{sh.score ?? '—'}}</strong>
                  <button (click)="deleteShot(sh.id)">🗑</button>
                  <button (click)="moveShot(sh.id, -1)" [disabled]="(sh.endIndex ?? 0) === 0">◀</button>
                  <button (click)="moveShot(sh.id, 1)" [disabled]="(sh.endIndex ?? 0) === maxEndIndex()">▶</button>
                </li>
              </ul>
            </details>
          </ng-container>
        </div>

        <div style="border:1px solid #eee;border-radius:8px;padding:10px">
          <div style="font-weight:600;margin-bottom:6px">
            Metrics
            <button (click)="metricsTab.set('end')" [disabled]="metricsTab() === 'end'">Current End</button>
            <button (click)="metricsTab.set('session')" [disabled]="metricsTab() === 'session'">Session</button>
          </div>

          <ng-container *ngIf="metricsTab() === 'end'">
            <ng-container *ngIf="endMetrics(); else noEndMetrics">
              <div>Mean radial error: {{endMetrics()?.meanRadialError | number:'1.0-1'}} px</div>
              <div>Group size (R95 proxy): {{endMetrics()?.groupSizeR95 | number:'1.0-1'}} px</div>
              <div>Bias distance: {{endMetrics()?.biasDistance | number:'1.0-1'}} px</div>
              <div>Bias angle: {{endMetrics()?.biasAngleDeg | number:'1.0-1'}}°</div>
            </ng-container>
            <ng-template #noEndMetrics>Calibrate and add shots to compute.</ng-template>
          </ng-container>

          <ng-container *ngIf="metricsTab() === 'session'">
            <ng-container *ngIf="metrics(); else noSessionMetrics">
              <div>Mean radial error: {{metrics()?.meanRadialError | number:'1.0-1'}} px</div>
              <div>Group size (R95 proxy): {{metrics()?.groupSizeR95 | number:'1.0-1'}} px</div>
              <div>Bias distance: {{metrics()?.biasDistance | number:'1.0-1'}} px</div>
              <div>Bias angle: {{metrics()?.biasAngleDeg | number:'1.0-1'}}°</div>
            </ng-container>
            <ng-template #noSessionMetrics>Calibrate and add shots to compute.</ng-template>
          </ng-container>
        </div>

        <div *ngIf="personalisedFeedback() as fb" style="border:1px solid #334155;border-radius:10px;padding:12px;background:#1e293b;color:white;box-shadow:0 6px 18px rgba(0,0,0,.25)">
          <div style="font-weight:700;margin-bottom:8px">Personalised Feedback</div>

          <div style="font-size:13px;line-height:1.45;color:#dbeafe;margin-bottom:8px">
            <strong>Pattern:</strong> {{fb.pattern}}
          </div>

          <div style="font-size:13px;line-height:1.45;margin-bottom:8px">
            {{fb.userContext}}
          </div>

          <div style="font-size:13px;line-height:1.45;margin-bottom:8px">
            <strong>Likely causes</strong>
            <ul style="margin:4px 0 0 18px;padding:0">
              <li *ngFor="let cause of fb.likelyCauses">{{cause}}</li>
            </ul>
          </div>

          <div style="font-size:13px;line-height:1.45;margin-bottom:8px">
            <strong>Suggested corrections</strong>
            <ul style="margin:4px 0 0 18px;padding:0">
              <li *ngFor="let correction of fb.corrections">{{correction}}</li>
            </ul>
          </div>

          <div style="font-size:13px;line-height:1.45;color:#fef3c7;margin-bottom:8px">
            <strong>Training focus:</strong> {{fb.trainingFocus}}
          </div>

          <div style="font-size:12px;line-height:1.45;color:#cbd5e1">
            {{fb.trendNote}}
          </div>
        </div>
      </aside>
    </div>

    <div style="margin-top:12px">
      <button (click)="newEnd()">New End</button>
      <button (click)="prevEnd()" [disabled]="currentEnd() === 0">Prev</button>
      <button (click)="nextEnd()" [disabled]="!hasNextEnd()">Next</button>

      <label>
        End size:
        <select [(ngModel)]="arrowsPerEndValue" (change)="setArrowsPerEnd()">
          <option [ngValue]="3">3</option>
          <option [ngValue]="6">6</option>
          <option [ngValue]="customArrowsPerEnd">Custom</option>
        </select>
        <input *ngIf="arrowsPerEndValue === customArrowsPerEnd" type="number" min="1" [(ngModel)]="customArrowsPerEnd" (change)="setArrowsPerEnd()">
      </label>
    </div>

    <div *ngIf="participants.length > 1" style="margin:8px 0 16px 0;display:flex;gap:8px;flex-wrap:wrap">
      <span *ngFor="let p of participants"
            (click)="selectActiveArcher(p.archerId)"
            [style.background]="activeArcherId() === p.archerId ? 'var(--accent)' : '#222'"
            [style.color]="activeArcherId() === p.archerId ? '#111' : '#fff'"
            style="padding:4px 14px;border-radius:999px;cursor:pointer;font-weight:600;font-size:14px">
        {{p.displayName}}
      </span>
    </div>

    <div *ngIf="!getCalForActiveArcher()?.centerX || !getCalForActiveArcher()?.ringRadiusPx" style="color:#e91e63;font-weight:600">
      Please calibrate centre and ring for this archer.
    </div>
  </section>
  `
})
export class SessionDetailComponent {
  private route = inject(ActivatedRoute);
  private db = inject(DbService);
  private metricsSvc = inject(MetricsService);

  @ViewChild('cnv', { static: true }) cnvRef!: ElementRef<HTMLCanvasElement>;

  session = signal<SessionMeta | undefined>(undefined);
  shots = signal<Shot[]>([]);
  metrics = signal<Metrics | undefined>(undefined);
  mode = signal<Mode>('calibrate-center');
  cal = signal<Partial<Calibration>>({});
  currentEnd = signal<number>(0);
  arrowsPerEnd = signal<number>(6);
  metricsTab = signal<'end' | 'session'>('end');
  activeArcherId = signal<string | undefined>(undefined);

  private img: HTMLImageElement | undefined;
  private scale = 1;
  private imgData?: ImageData;

  arrowsPerEndValue = 6;
  customArrowsPerEnd = 6;

  get participants() {
    return this.session()?.participants ?? [];
  }

  get activeArcher() {
    return this.participants.find(p => p.archerId === this.activeArcherId());
  }

  async ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) return;

    const s = await this.db.getSession(id);
    this.session.set(s || undefined);

    if (s) {
      this.activeArcherId.set(s.ownerArcherId || s.participants?.[0]?.archerId);
    }

    this.arrowsPerEnd.set(s?.arrowsPerEnd ?? 6);
    this.arrowsPerEndValue = s?.arrowsPerEnd ?? 6;

    if (s?.photoPath) await this.loadAndPrepareImage(s.photoPath);

    if (s?.calibration) {
      this.cal.set({ ...s.calibration });
      this.mode.set('mark-shots');
    }

    await this.refreshShots();

    effect(() => this.draw());
    this.recompute();
  }

  async onFile(ev: Event) {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;

    const dataUrl = await this.fileToDataURL(file);
    const s = this.session();
    if (!s) return;

    s.photoPath = dataUrl;
    s.updatedAt = Date.now();
    await this.db.upsertSession(s);
    this.session.set(s);

    await this.loadAndPrepareImage(dataUrl);
    this.mode.set('calibrate-center');
    this.cal.set({});
    this.draw();
  }

  private async loadAndPrepareImage(dataUrl: string) {
    const img = await this.createImage(dataUrl);
    this.img = img;

    const canvas = this.cnvRef.nativeElement;
    const maxW = 900;
    const scale = img.width > maxW ? maxW / img.width : 1;

    this.scale = scale;
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);

    const off = document.createElement('canvas');
    off.width = img.width;
    off.height = img.height;

    const octx = off.getContext('2d')!;
    octx.drawImage(img, 0, 0);
    this.imgData = octx.getImageData(0, 0, off.width, off.height);

    this.draw();
  }

  private createImage(dataUrl: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  setMode(m: Mode) {
    this.mode.set(m);
  }

  hasCenter() {
    return this.cal().centerX != null && this.cal().centerY != null;
  }

  hasRing() {
    return (this.cal().ringRadiusPx ?? 0) > 0;
  }

  isCalibrated() {
    return this.hasCenter() && this.hasRing();
  }

  async onCanvasClick(ev: MouseEvent) {
    const s = this.session();
    if (!s) return;

    const canvas = this.cnvRef.nativeElement;
    const rect = canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;

    const m = this.mode();

    if (m === 'calibrate-center') {
      this.cal.set({ ...this.cal(), centerX: x, centerY: y });
      if (!this.cal().ringRadiusPx) this.mode.set('calibrate-ring');
      await this.autoSaveIfReady();
      this.draw();
      return;
    }

    if (m === 'calibrate-ring') {
      if (!this.hasCenter()) return;

      const cx = this.cal().centerX!;
      const cy = this.cal().centerY!;
      const approx = Math.hypot(x - cx, y - cy);
      const snapped = this.snapRadiusToEdge(cx, cy, x, y, approx);

      this.cal.set({ ...this.cal(), ringRadiusPx: Math.max(1, snapped ?? approx) });
      await this.autoSaveIfReady();
      this.mode.set('mark-shots');
      this.draw();
      return;
    }

    if (m === 'mark-shots' && this.isCalibrated()) {
      const now = Date.now();
      const score = this.scoreFor(x, y);
      const shot: Shot = {
        id: uuid(),
        sessionId: s.id,
        x,
        y,
        order: this.shotsForActiveArcher().length + 1,
        score,
        createdAt: now,
        endIndex: this.currentEnd(),
        archerId: this.activeArcherId()
      };

      await this.db.addShot(shot);
      this.shots.set(await this.db.listShotsBySession(s.id));
      this.recompute();
      this.draw();

      const endShots = this.shotsForEnd(this.currentEnd());
      if (this.arrowsPerEnd() && endShots.length >= this.arrowsPerEnd()) {
        if (confirm('End complete. Start new end?')) this.newEnd();
      }
    }
  }

  private async autoSaveIfReady() {
    if (!this.isCalibrated()) return;

    const s = this.session();
    if (!s) return;

    if (!s.calibrations) s.calibrations = {};

    const aid = this.activeArcherId();
    if (aid) {
      s.calibrations[aid] = {
        centerX: this.cal().centerX!,
        centerY: this.cal().centerY!,
        ringRadiusPx: this.cal().ringRadiusPx!
      };
    }

    s.updatedAt = Date.now();
    await this.db.upsertSession(s);
    this.session.set(s);
    this.recompute();
  }

  undo() {
    const arr = this.shots().slice(0, -1);
    this.shots.set(arr);
    this.persistShotsReplace(arr);
    this.recompute();
    this.draw();
  }

  clearShots() {
    this.shots.set([]);
    this.persistShotsReplace([]);
    this.recompute();
    this.draw();
  }

  private async persistShotsReplace(shots: Shot[]) {
    const s = this.session();
    if (!s) return;

    const keep = s;
    await this.db.deleteSessionCascade(s.id);
    await this.db.upsertSession(keep);

    for (const sh of shots) {
      await this.db.addShot(sh);
    }
  }

  private scoreFor(x: number, y: number): number | undefined {
    const cal = this.getCalForActiveArcher();
    if (!cal) return undefined;

    const { centerX, centerY, ringRadiusPx } = cal;
    const dist = Math.hypot(x - centerX, y - centerY);
    const band = Math.floor(dist / Math.max(1, ringRadiusPx));

    return Math.max(0, 10 - band);
  }

  async refreshShots() {
    const s = this.session();
    if (!s) return;

    this.shots.set(await this.db.listShotsBySession(s.id));
  }

  async recompute() {
    const s = this.session();
    if (!s) return;

    const cal = this.getCalForActiveArcher();
    const shots = this.shotsForActiveArcher();

    if (!cal || shots.length === 0) {
      this.metrics.set(undefined);
      return;
    }

    const m = this.metricsSvc.compute(s.id, shots, cal);
    await this.db.upsertMetrics(m);
    this.metrics.set(m);
  }

  private draw() {
    const canvas = this.cnvRef?.nativeElement;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (this.img) ctx.drawImage(this.img, 0, 0, canvas.width, canvas.height);

    const c = this.cal();

    if (c.centerX != null && c.centerY != null) {
      ctx.beginPath();
      ctx.arc(c.centerX, c.centerY, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#00aaff';
      ctx.fill();
    }

    if (this.isCalibrated()) {
      this.drawRings(ctx, c.centerX!, c.centerY!, c.ringRadiusPx!);
    }

    for (const sh of this.shots()) {
      ctx.beginPath();
      ctx.arc(sh.x, sh.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = sh.archerId === this.activeArcherId() ? '#e91e63' : 'rgba(120,120,120,.55)';
      ctx.fill();

      if (sh.score != null) {
        ctx.font = '12px system-ui';
        ctx.fillStyle = '#222';
        ctx.fillText(String(sh.score), sh.x + 7, sh.y - 7);
      }
    }

    ctx.font = '13px system-ui';
    ctx.fillStyle = '#333';

    const hint =
      this.mode() === 'calibrate-center' ? 'Click target centre' :
      this.mode() === 'calibrate-ring' ? 'Click near a ring edge — I will auto-snap' :
      'Click to add shots';

    ctx.fillText(hint, 8, 18);
  }

  private drawRings(ctx: CanvasRenderingContext2D, cx: number, cy: number, ringRadiusPx: number) {
    const major = '#3ea3ff';
    const minor = 'rgba(62,163,255,.35)';

    for (let k = 10; k >= 1; k--) {
      const r = k * ringRadiusPx;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);

      const isMajor = k % 2 === 0;
      ctx.lineWidth = isMajor ? 1.5 : 1;
      ctx.setLineDash(isMajor ? [6, 4] : [3, 4]);
      ctx.strokeStyle = isMajor ? major : minor;
      ctx.stroke();
    }

    ctx.setLineDash([]);
  }

  private snapRadiusToEdge(cx: number, cy: number, x: number, y: number, approxR: number): number | undefined {
    if (!this.imgData || !this.img || approxR <= 0) return undefined;

    const sx = x / this.scale;
    const sy = y / this.scale;
    const scx = cx / this.scale;
    const scy = cy / this.scale;

    const baseTheta = Math.atan2(sy - scy, sx - scx);
    const angles = [0, Math.PI / 6, -Math.PI / 6, Math.PI / 3, -Math.PI / 3];
    const radii: number[] = [];

    for (const dTheta of angles) {
      const theta = baseTheta + dTheta;
      let bestR = approxR;
      let bestG = 0;

      for (let dr = -15; dr <= 15; dr++) {
        const r = approxR + dr;
        if (r <= 2) continue;

        const g = Math.abs(this.radialGradient(scx, scy, theta, r));
        if (g > bestG) {
          bestG = g;
          bestR = r;
        }
      }

      radii.push(bestR);
    }

    radii.sort((a, b) => a - b);
    return radii[Math.floor(radii.length / 2)];
  }

  private radialGradient(cx: number, cy: number, theta: number, r: number): number {
    const p1 = { x: cx + (r - 1) * Math.cos(theta), y: cy + (r - 1) * Math.sin(theta) };
    const p2 = { x: cx + (r + 1) * Math.cos(theta), y: cy + (r + 1) * Math.sin(theta) };
    const L1 = this.sampleLuma(p1.x, p1.y);
    const L2 = this.sampleLuma(p2.x, p2.y);

    return L2 - L1;
  }

  private sampleLuma(ix: number, iy: number): number {
    if (!this.imgData) return 0;

    const x = Math.max(0, Math.min(this.imgData.width - 1, Math.round(ix)));
    const y = Math.max(0, Math.min(this.imgData.height - 1, Math.round(iy)));
    const i = (y * this.imgData.width + x) * 4;

    const r = this.imgData.data[i];
    const g = this.imgData.data[i + 1];
    const b = this.imgData.data[i + 2];

    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  async exportSession() {
    const s = this.session();
    if (!s) return;

    const shots = await this.db.listShotsBySession(s.id);
    const metrics = await this.db.getMetrics?.(s.id);
    const payload = { session: { ...s, arrowsPerEnd: this.arrowsPerEnd() }, shots, metrics };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');

    a.href = url;
    a.download = `archery-session-${s.id}.json`;
    a.click();

    URL.revokeObjectURL(url);
  }

  async importSession(ev: Event) {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;

    const text = await file.text();
    const data = JSON.parse(text) as { session: SessionMeta, shots: Shot[], metrics?: Metrics };

    const old = data.session;
    const newId = crypto.randomUUID?.() || Math.random().toString(36).slice(2);
    const s: SessionMeta = { ...old, id: newId, createdAt: Date.now(), updatedAt: Date.now() };

    await this.db.upsertSession(s);

    for (const sh of data.shots || []) {
      await this.db.addShot({
        ...sh,
        id: crypto.randomUUID?.() || Math.random().toString(36).slice(2),
        sessionId: s.id
      });
    }

    if (data.metrics) {
      await this.db.upsertMetrics?.({ ...data.metrics, sessionId: s.id, computedAt: Date.now() });
    }

    this.session.set(await this.db.getSession(s.id) || undefined);
    this.arrowsPerEnd.set(s.arrowsPerEnd ?? 6);
    this.arrowsPerEndValue = s.arrowsPerEnd ?? 6;

    await this.refreshShots();
    this.recompute();
    this.draw();
  }

  ngAfterViewInit() {
    window.addEventListener('keydown', this.keyHandler);
  }

  ngOnDestroy() {
    window.removeEventListener('keydown', this.keyHandler);
  }

  keyHandler = (e: KeyboardEvent) => {
    if (e.key.toLowerCase() === 'z') this.undoCurrentEnd();
    if (e.key.toLowerCase() === 'n') this.newEnd();
    if (e.key === '[') this.prevEnd();
    if (e.key === ']') this.nextEnd();
  };

  undoCurrentEnd() {
    const arr = this.shots();
    const idx = arr.map(s => s.endIndex ?? 0).lastIndexOf(this.currentEnd());

    if (idx >= 0) {
      arr.splice(idx, 1);
      this.shots.set([...arr]);
      this.persistShotsReplace(this.shots());
      this.recompute();
      this.draw();
    }
  }

  newEnd() {
    this.currentEnd.set(this.maxEndIndex() + 1);
  }

  prevEnd() {
    if (this.currentEnd() > 0) this.currentEnd.set(this.currentEnd() - 1);
  }

  nextEnd() {
    if (this.currentEnd() < this.maxEndIndex()) this.currentEnd.set(this.currentEnd() + 1);
  }

  hasNextEnd() {
    return this.currentEnd() < this.maxEndIndex();
  }

  maxEndIndex() {
    return Math.max(0, ...this.shotsForActiveArcher().map(sh => sh.endIndex ?? 0));
  }

  setArrowsPerEnd() {
    const val = this.arrowsPerEndValue === this.customArrowsPerEnd ? this.customArrowsPerEnd : this.arrowsPerEndValue;

    this.arrowsPerEnd.set(val);

    const s = this.session();
    if (s) {
      s.arrowsPerEnd = val;
      this.db.upsertSession(s);
      this.session.set(s);
    }
  }

  selectActiveArcher(archerId: string) {
    this.activeArcherId.set(archerId);
    this.recompute();
    this.draw();
  }

  shotsForActiveArcher() {
    return this.shots().filter(s => s.archerId === this.activeArcherId());
  }

  shotsForEnd(end: number) {
    return this.shotsForActiveArcher().filter(s => (s.endIndex ?? 0) === end);
  }

  endIndices() {
    const ends = new Set<number>();

    for (const sh of this.shotsForActiveArcher()) {
      ends.add(sh.endIndex ?? 0);
    }

    return Array.from(ends).sort((a, b) => a - b);
  }

  endTotal(end: number) {
    return this.shotsForEnd(end).reduce((sum, s) => sum + (s.score ?? 0), 0);
  }

  endAvg(end: number) {
    const arr = this.shotsForEnd(end);
    return arr.length ? this.endTotal(end) / arr.length : 0;
  }

  clearEnd(end: number) {
    const keep = this.shots().filter(s => (s.endIndex ?? 0) !== end);
    this.shots.set(keep);
    this.persistShotsReplace(keep);
    this.recompute();
    this.draw();
  }

  deleteEnd(end: number) {
    const keep = this.shots().filter(s => (s.endIndex ?? 0) !== end);

    for (const sh of keep) {
      if ((sh.endIndex ?? 0) > end) {
        sh.endIndex = (sh.endIndex ?? 0) - 1;
      }
    }

    this.shots.set(keep);
    this.persistShotsReplace(keep);
    this.recompute();
    this.draw();
  }

  deleteShot(id: string) {
    const keep = this.shots().filter(s => s.id !== id);
    this.shots.set(keep);
    this.persistShotsReplace(keep);
    this.recompute();
    this.draw();
  }

  moveShot(id: string, dir: number) {
    const arr = this.shots();
    const idx = arr.findIndex(s => s.id === id);

    if (idx < 0) return;

    const sh = arr[idx];
    sh.endIndex = Math.max(0, Math.min(this.maxEndIndex(), (sh.endIndex ?? 0) + dir));

    this.shots.set([...arr]);
    this.persistShotsReplace(this.shots());
    this.recompute();
    this.draw();
  }

  endMetrics() {
    const s = this.session();
    if (!s) return undefined;

    const shots = this.shotsForEnd(this.currentEnd());
    const cal = this.getCalForActiveArcher();

    if (!shots.length || !cal) return undefined;

    return this.metricsSvc.compute(s.id, shots, cal);
  }

  personalisedFeedback(): FeedbackResult | undefined {
    const cal = this.getCalForActiveArcher();
    if (!cal) return undefined;

    const currentShots = this.shotsForEnd(this.currentEnd());
    const sessionShots = this.shotsForActiveArcher();

    if (currentShots.length < 2) return undefined;

    const selectedShots = currentShots.length >= 3 ? currentShots : sessionShots;
    if (selectedShots.length < 2) return undefined;

    const user = this.getUserContext();
    const analysis = this.analyseShotPattern(selectedShots, cal);
    const consistency = this.getConsistencyLabel(analysis.groupSpread, cal.ringRadiusPx);
    const pattern = `${analysis.verticalLabel}-${analysis.horizontalLabel} grouping detected across ${currentShots.length >= 3 ? 'this end' : 'the session'} (${consistency}).`;

    const likelyCauses = this.getLikelyCauses(user, analysis, consistency);
    const corrections = this.getCorrections(user, analysis, consistency);
    const trainingFocus = this.getTrainingFocus(analysis, consistency);
    const trendNote = this.getTrendNote(user, analysis, sessionShots.length);

    return {
      title: 'Personalised Feedback',
      pattern,
      userContext: `For a ${user.handednessLabel} archer using ${user.bowTypeLabel}, this pattern suggests a repeatable shooting tendency rather than a single random miss.`,
      likelyCauses,
      corrections,
      trainingFocus,
      trendNote
    };
  }

  private getUserContext() {
    const archer: any = this.activeArcher ?? {};
    const handednessRaw = String(archer.handedness ?? archer.hand ?? archer.dominantHand ?? 'right').toLowerCase();
    const bowTypeRaw = String(archer.bowType ?? archer.style ?? archer.discipline ?? 'barebow').toLowerCase();
    const experienceRaw = String(archer.experience ?? archer.skillLevel ?? 'intermediate').toLowerCase();
    const eyeRaw = String(archer.eyeDominance ?? archer.dominantEye ?? '').toLowerCase();

    const handedness = handednessRaw.includes('left') ? 'left' : 'right';
    const handednessLabel = handedness === 'left' ? 'left-handed' : 'right-handed';

    let bowTypeLabel = 'barebow';
    if (bowTypeRaw.includes('recurve')) bowTypeLabel = 'recurve';
    if (bowTypeRaw.includes('compound')) bowTypeLabel = 'compound';
    if (bowTypeRaw.includes('longbow')) bowTypeLabel = 'longbow';
    if (bowTypeRaw.includes('bare')) bowTypeLabel = 'barebow';

    let experienceLabel = 'intermediate';
    if (experienceRaw.includes('beginner')) experienceLabel = 'beginner';
    if (experienceRaw.includes('advanced')) experienceLabel = 'advanced';
    if (experienceRaw.includes('experienced')) experienceLabel = 'experienced';
    if (experienceRaw.includes('intermediate')) experienceLabel = 'intermediate';

    const eyeLabel = eyeRaw.includes('left') ? 'left-eye dominant' : eyeRaw.includes('right') ? 'right-eye dominant' : 'eye dominance not specified';

    return {
      handedness,
      handednessLabel,
      bowTypeLabel,
      experienceLabel,
      eyeLabel
    };
  }

  private analyseShotPattern(shots: Shot[], cal: Calibration) {
    const meanX = shots.reduce((sum, s) => sum + s.x, 0) / shots.length;
    const meanY = shots.reduce((sum, s) => sum + s.y, 0) / shots.length;

    const dx = meanX - cal.centerX;
    const dy = meanY - cal.centerY;

    const horizontalThreshold = Math.max(8, cal.ringRadiusPx * 0.6);
    const verticalThreshold = Math.max(8, cal.ringRadiusPx * 0.6);

    const horizontalLabel = dx < -horizontalThreshold ? 'left' : dx > horizontalThreshold ? 'right' : 'centred';
    const verticalLabel = dy < -verticalThreshold ? 'high' : dy > verticalThreshold ? 'bottom' : 'centre';

    const distsFromMean = shots.map(s => Math.hypot(s.x - meanX, s.y - meanY));
    const groupSpread = distsFromMean.reduce((sum, d) => sum + d, 0) / shots.length;

    const distFromCentre = Math.hypot(dx, dy);
    const biasAngle = Math.atan2(dy, dx) * 180 / Math.PI;

    return {
      meanX,
      meanY,
      dx,
      dy,
      horizontalLabel,
      verticalLabel,
      groupSpread,
      distFromCentre,
      biasAngle
    };
  }

  private getConsistencyLabel(groupSpread: number, ringRadiusPx: number) {
    if (groupSpread <= ringRadiusPx * 0.75) return 'tight grouping';
    if (groupSpread <= ringRadiusPx * 1.6) return 'moderate grouping';
    return 'wide grouping';
  }

  private getLikelyCauses(user: any, analysis: any, consistency: string) {
    const causes: string[] = [];

    if (analysis.verticalLabel === 'bottom') {
      causes.push('Bow arm may be dropping before the shot has fully completed');
      causes.push('Follow-through may be collapsing downward after release');
    }

    if (analysis.verticalLabel === 'high') {
      causes.push('Bow shoulder may be lifting or tension may be increasing before release');
      causes.push('Anchor position may be changing slightly between shots');
    }

    if (analysis.horizontalLabel === 'left') {
      if (user.handedness === 'right') {
        causes.push('For a right-handed archer, left impact can be linked to release tension, plucking the string, or alignment closing toward the bow side');
      } else {
        causes.push('For a left-handed archer, left impact may point toward aim alignment or bow arm pressure changes');
      }
    }

    if (analysis.horizontalLabel === 'right') {
      if (user.handedness === 'right') {
        causes.push('For a right-handed archer, right impact may suggest bow hand torque or over-correction during aim');
      } else {
        causes.push('For a left-handed archer, right impact can be linked to release tension, plucking the string, or alignment closing toward the bow side');
      }
    }

    if (consistency === 'wide grouping') {
      causes.push('Shot routine may not be repeating consistently between arrows');
      causes.push('Anchor point, release timing, or sight picture may be varying across the end');
    }

    if (!causes.length) {
      causes.push('Shot placement is reasonably centred, so the main focus should be maintaining the current process');
      causes.push('Any remaining variation is more likely linked to small consistency changes than a major aiming issue');
    }

    return causes.slice(0, 4);
  }

  private getCorrections(user: any, analysis: any, consistency: string) {
    const corrections: string[] = [];

    if (analysis.verticalLabel === 'bottom') {
      corrections.push('Keep the bow arm up until the arrow has landed rather than relaxing immediately after release');
      corrections.push('Aim slightly higher only if the same low grouping repeats across multiple ends');
    }

    if (analysis.verticalLabel === 'high') {
      corrections.push('Check that the bow shoulder stays relaxed and does not rise during the draw');
      corrections.push('Confirm the same anchor height is being used before each release');
    }

    if (analysis.horizontalLabel === 'left') {
      corrections.push(user.handedness === 'right'
        ? 'Focus on a cleaner release and avoid pulling the string outward at the point of release'
        : 'Check bow hand pressure and avoid pushing the bow across the target line');
    }

    if (analysis.horizontalLabel === 'right') {
      corrections.push(user.handedness === 'right'
        ? 'Check bow hand pressure and avoid twisting the grip during the shot'
        : 'Focus on a cleaner release and avoid pulling the string outward at the point of release');
    }

    if (consistency === 'wide grouping') {
      corrections.push('Slow the shot routine down and repeat the same anchor, aim, release, and follow-through process');
    }

    if (!corrections.length) {
      corrections.push('Continue using the same shot routine and monitor whether the group stays centred over the next end');
    }

    return corrections.slice(0, 4);
  }

  private getTrainingFocus(analysis: any, consistency: string) {
    if (consistency === 'wide grouping') {
      return 'Prioritise repeatability before making major aim adjustments.';
    }

    if (analysis.verticalLabel === 'bottom' && analysis.horizontalLabel === 'left') {
      return 'Main focus should be bow arm stability, follow-through, and avoiding collapse through release.';
    }

    if (analysis.verticalLabel === 'bottom' && analysis.horizontalLabel === 'right') {
      return 'Main focus should be follow-through and reducing bow hand movement during release.';
    }

    if (analysis.verticalLabel === 'high') {
      return 'Main focus should be relaxed shoulder position and consistent anchor height.';
    }

    if (analysis.horizontalLabel === 'left' || analysis.horizontalLabel === 'right') {
      return 'Main focus should be alignment, grip pressure, and release direction.';
    }

    return 'Main focus should be maintaining the current grouping while tracking whether the pattern stays stable.';
  }

  private getTrendNote(user: any, analysis: any, sessionShotCount: number) {
    const direction = `${analysis.verticalLabel}-${analysis.horizontalLabel}`.replace('centre-', '').replace('-centred', '');

    if (sessionShotCount >= 12) {
      return `Because this profile already has ${sessionShotCount} recorded shots, the system can compare this end against previous ends and check whether the ${direction} pattern is becoming more frequent over time.`;
    }

    return `As more ends are recorded for this ${user.experienceLabel} archer, feedback can become more specific by comparing repeated patterns across sessions rather than judging one end in isolation.`;
  }

  getCalForActiveArcher(): Calibration | undefined {
    const s = this.session();
    const aid = this.activeArcherId();

    return (s?.calibrations && aid && s.calibrations[aid]) || s?.calibration;
  }

  private fileToDataURL(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }
}