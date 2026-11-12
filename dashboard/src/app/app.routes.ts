import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'home' },
  {
    path: 'home',
    loadComponent: () => import('./pages/home/home').then((m) => m.Home),
  },
  {
    path: 'agents',
    loadComponent: () => import('./pages/agents/agents').then((m) => m.Agents),
  },
  {
    path: 'workspaces',
    loadComponent: () => import('./pages/workspaces/workspaces').then((m) => m.Workspaces),
  },
  {
    path: 'workspaces/:id',
    loadComponent: () => import('./pages/workspace-detail/workspace-detail').then((m) => m.WorkspaceDetail),
  },
  {
    path: 'conversations/:id',
    loadComponent: () => import('./pages/conversation/conversation').then((m) => m.ConversationPage),
  },
  {
    path: 'settings',
    loadComponent: () => import('./pages/settings/settings').then((m) => m.Settings),
  },
  { path: '**', redirectTo: 'home' },
];
