import { Routes } from '@angular/router';
import { ProfilesComponent } from './pages/profiles.component';
import { SessionsComponent } from './pages/sessions.component';
import { SessionDetailComponent } from './pages/session-detail.component';

export const routes: Routes = [
  { path: '', redirectTo: 'profiles', pathMatch: 'full' },
  { path: 'profiles', component: ProfilesComponent },
  { path: 'sessions/:archerId', component: SessionsComponent },
  { path: 'session/:id', component: SessionDetailComponent },
];
