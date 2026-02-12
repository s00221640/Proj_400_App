import { Injectable } from '@angular/core';
import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { ArcherProfile, SessionMeta, Shot, Metrics } from '../models';

interface ArcheryDB extends DBSchema {
  profiles: { key: string; value: ArcherProfile };
  sessions: { key: string; value: SessionMeta; indexes: { 'by-archer': string } };
  shots:    { key: string; value: Shot; indexes: { 'by-session': string } };
  metrics:  { key: string; value: Metrics; indexes: { 'by-session': string } };
}

@Injectable({ providedIn: 'root' })
export class DbService {
  private db: Promise<IDBPDatabase<ArcheryDB>>;

  constructor() {
    this.db = openDB<ArcheryDB>('archery-db', 1, {
      upgrade(db) {
        db.createObjectStore('profiles', { keyPath: 'id' });
        const sessions = db.createObjectStore('sessions', { keyPath: 'id' });
        sessions.createIndex('by-archer', 'archerId');

        const shots = db.createObjectStore('shots', { keyPath: 'id' });
        shots.createIndex('by-session', 'sessionId');

        const metrics = db.createObjectStore('metrics', { keyPath: 'sessionId' });
        metrics.createIndex('by-session', 'sessionId');
      }
    });
  }

  async upsertProfile(p: ArcherProfile) {
    const db = await this.db;
    await db.put('profiles', p);
    return p;
  }
  async listProfiles() {
    const db = await this.db;
    return db.getAll('profiles');
  }
  async getProfile(id: string) {
    const db = await this.db;
    return db.get('profiles', id);
  }
  async deleteProfile(id: string) {
    const db = await this.db;
    const sessions = await this.listSessionsByArcher(id);
    for (const s of sessions) await this.deleteSessionCascade(s.id);
    await db.delete('profiles', id);
  }

  async upsertSession(s: SessionMeta) {
    const db = await this.db;
    await db.put('sessions', s);
    return s;
  }
  async getSession(id: string) {
    const db = await this.db;
    return db.get('sessions', id);
  }
  async listSessionsByArcher(archerId: string) {
    const db = await this.db;
    return db.getAllFromIndex('sessions', 'by-archer', archerId);
  }
  async deleteSessionCascade(sessionId: string) {
    const db = await this.db;
    const shots = await db.getAllFromIndex('shots', 'by-session', sessionId);
    for (const sh of shots) await db.delete('shots', sh.id);
    await db.delete('metrics', sessionId);
    await db.delete('sessions', sessionId);
  }

  async addShot(shot: Shot) {
    const db = await this.db;
    await db.add('shots', shot);
    return shot;
  }
  async listShotsBySession(sessionId: string) {
    const db = await this.db;
    return db.getAllFromIndex('shots', 'by-session', sessionId);
  }
  async listShotsBySessionAndArcher(sessionId: string, archerId: string, session?: SessionMeta) {
    const db = await this.db;
    const all = await db.getAllFromIndex('shots', 'by-session', sessionId);
    return all.filter(sh => {
      if (sh.archerId) return sh.archerId === archerId;
      // fallback: treat as owner or first participant
      if (session) {
        if (session.ownerArcherId && archerId === session.ownerArcherId) return true;
        if (session.participants?.length && archerId === session.participants[0].archerId) return true;
        return false;
      }
      return true; // fallback: include if archerId missing and no session info
    });
  }

  async upsertMetrics(m: Metrics) {
    const db = await this.db;
    await db.put('metrics', m);
    return m;
  }
  async getMetrics(sessionId: string) {
    const db = await this.db;
    return db.get('metrics', sessionId);
  }
}
