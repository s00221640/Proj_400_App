import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { DbService } from '../services/db.services';
import { SessionMeta } from '../models';
import { v4 as uuid } from 'uuid';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-sessions',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  template: `
<section style="max-width:900px;margin:16px auto;padding:12px">
  <a [routerLink]="['/profiles']" style="display:inline-block;margin-bottom:16px;color:#1976d2;text-decoration:underline;font-weight:500;">
    ← Back to Profiles
  </a>
  <h2>Sessions</h2>
  <button (click)="openNewSessionDialog()" style="margin-bottom:16px">New Session</button>
  <div style="display: flex; flex-wrap: wrap; gap: 18px;">
    <div *ngFor="let s of sessions()" class="card" style="width: 320px; display: flex; flex-direction: column; gap: 8px;">
      <div style="display: flex; align-items: center; gap: 12px;">
        <img *ngIf="s.photoPath" [src]="s.photoPath" alt="thumb" style="width: 56px; height: 56px; object-fit: cover; border-radius: 8px; border: 1px solid #222;">
        <div>
          <div style="font-weight:600">{{s.roundName || 'Session'}}</div>
          <div style="font-size:12px;color:#888">{{s.dateIso | date:'mediumDate'}} • {{s.distanceMeters || '—'}}m • {{s.targetFace || '—'}}</div>
        </div>
      </div>
      <div style="display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0;">
        <span *ngFor="let p of s.participants" style="background: #222; color: #fff; border-radius: 999px; padding: 2px 10px; font-size: 13px;">
          {{p.displayName}}
        </span>
      </div>
      <div style="font-size:12px;color:#aaa;">
        {{s.participants?.length || 1}} participant{{(s.participants?.length || 1) > 1 ? 's' : ''}}
      </div>
      <div style="display: flex; gap: 10px; margin-top: 8px;">
        <a [routerLink]="['/session', s.id]" class="btn">Open</a>
        <button (click)="remove(s.id)" class="btn" style="background:#c00;color:#fff;">Delete</button>
      </div>
    </div>
  </div>
</section>

<!-- New Session Dialog -->
<div *ngIf="showDialog" style="position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:1000;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;">
  <form (submit)="create($event)" style="background:var(--surface);padding:24px 32px;border-radius:12px;min-width:320px;box-shadow:var(--elev);display:flex;flex-direction:column;gap:14px;">
    <h3 style="margin:0 0 8px 0;">New Session</h3>
    <label>Participants:</label>
    <div style="display:flex;flex-wrap:wrap;gap:8px;">
      <label *ngFor="let p of profiles">
        <input type="checkbox" [value]="p.id" [(ngModel)]="selectedArcherIds" name="archers" [checked]="selectedArcherIds.includes(p.id)">
        {{p.name}}
      </label>
    </div>
    <label>Owner:
      <select [(ngModel)]="ownerArcherId" name="owner" required>
        <option *ngFor="let p of profiles" [value]="p.id">{{p.name}}</option>
      </select>
    </label>
    <label>Round name: <input [(ngModel)]="roundName" name="round"></label>
    <label>Distance (m): <input type="number" [(ngModel)]="distance" name="distance"></label>
    <label>Target face: <input [(ngModel)]="targetFace" name="face"></label>
    <label>Arrows per end:
      <input type="number" min="1" [(ngModel)]="arrowsPerEnd" name="arrowsPerEnd">
    </label>
    <div style="display:flex;gap:12px;justify-content:flex-end;">
      <button type="button" (click)="closeDialog()">Cancel</button>
      <button type="submit" [disabled]="!selectedArcherIds.length || !ownerArcherId">Create</button>
    </div>
  </form>
</div>
`
})
export class SessionsComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private db = inject(DbService);

  archerId = '';
  sessions = signal<SessionMeta[]>([]);

  roundName = '';
  distance?: number;
  targetFace = '';

  profiles: any[] = [];
  showDialog = false;
  selectedArcherIds: string[] = [];
  ownerArcherId: string = '';
  arrowsPerEnd: number = 6;

  async ngOnInit() {
    this.archerId = this.route.snapshot.params['archerId'];
    await this.refresh();
    this.profiles = await this.db.listProfiles();
    if (this.profiles.length) {
      this.selectedArcherIds = [this.archerId];
      this.ownerArcherId = this.archerId;
    }
  }

  async refresh() {
    this.sessions.set(await this.db.listSessionsByArcher(this.archerId));
  }

  openNewSessionDialog() {
    this.showDialog = true;
    if (!this.selectedArcherIds.length && this.profiles.length) {
      this.selectedArcherIds = [this.profiles[0].id];
      this.ownerArcherId = this.profiles[0].id;
    }
  }
  closeDialog() {
    this.showDialog = false;
  }

  async create(e: Event) {
    e.preventDefault();
    const now = Date.now();
    const participants = this.profiles
      .filter(p => this.selectedArcherIds.includes(p.id))
      .map(p => ({ archerId: p.id, displayName: p.name }));
    const s: SessionMeta = {
      id: uuid(),
      archerId: this.ownerArcherId,
      ownerArcherId: this.ownerArcherId,
      dateIso: new Date().toISOString(),
      roundName: this.roundName || undefined,
      distanceMeters: this.distance,
      targetFace: this.targetFace || undefined,
      createdAt: now,
      updatedAt: now,
      participants,
      arrowsPerEnd: this.arrowsPerEnd
    };
    await this.db.upsertSession(s);
    this.roundName = '';
    this.distance = undefined;
    this.targetFace = '';
    this.selectedArcherIds = [];
    this.ownerArcherId = '';
    this.arrowsPerEnd = 6;
    this.closeDialog();
    await this.refresh();
  }

  async remove(id: string) {
    await this.db.deleteSessionCascade(id);
    await this.refresh();
  }
}
