import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type {
  AgentProfile, Conversation, AgentMessage, Metrics, Health, Workspace,
} from './models.js';

// nginx hace proxy de /api -> orquestador y de /ws -> WebSocket del orquestador.
const API = '/api';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);

  health() {
    return firstValueFrom(this.http.get<Health>(`${API}/health`));
  }

  // Agentes (la API devuelve filas crudas snake_case -> normalizamos).
  async agents(): Promise<AgentProfile[]> {
    const rows = await firstValueFrom(this.http.get<any[]>(`${API}/agents`));
    return rows.map((r) => ({
      key: r.key,
      role: r.role,
      name: r.name,
      description: r.description,
      defaultModel: r.default_model ?? r.defaultModel,
      skills: r.skills ?? [],
      hooks: r.hooks ?? [],
      permissions: r.permissions ?? {},
    }));
  }

  // Workspaces
  workspaces() {
    return firstValueFrom(this.http.get<Workspace[]>(`${API}/workspaces`));
  }
  createWorkspace(body: {
    name: string;
    description?: string;
    sourceType?: 'empty' | 'local' | 'github';
    repos?: string[];
    localSubpath?: string;
  }) {
    return firstValueFrom(this.http.post<Workspace>(`${API}/workspaces`, body));
  }
  workspace(id: string) {
    return firstValueFrom(
      this.http.get<Workspace & { conversations: Conversation[] }>(`${API}/workspaces/${id}`),
    );
  }
  workspaceMetrics(id: string) {
    return firstValueFrom(this.http.get<Metrics>(`${API}/workspaces/${id}/metrics`));
  }

  // Conversaciones
  createConversation(workspaceId: string, body: {
    title?: string; goal: string; strategy?: string;
    maxIterations?: number; parallelDev?: number; maxParallel?: number; budgetUsd?: number;
  }) {
    return firstValueFrom(
      this.http.post<Conversation>(`${API}/workspaces/${workspaceId}/conversations`, body),
    );
  }
  conversation(id: string) {
    return firstValueFrom(this.http.get<Conversation>(`${API}/conversations/${id}`));
  }
  messages(id: string) {
    return firstValueFrom(this.http.get<AgentMessage[]>(`${API}/conversations/${id}/messages`));
  }
  metrics(id: string) {
    return firstValueFrom(this.http.get<Metrics>(`${API}/conversations/${id}/metrics`));
  }
  start(id: string) {
    return firstValueFrom(this.http.post(`${API}/conversations/${id}/start`, {}));
  }
  stop(id: string) {
    return firstValueFrom(this.http.post(`${API}/conversations/${id}/stop`, {}));
  }
}
