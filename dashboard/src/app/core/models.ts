// Modelos del dominio en el front. Reflejan la API del orquestador.
// Nota: la API devuelve agent_profiles en snake_case; se normaliza en el servicio.

export type AgentRole = 'po' | 'ux' | 'dev' | 'validator';
export type ControlSignal = 'DONE' | 'SKIP' | 'CHANGES' | 'APPROVED' | 'BLOCKED';
export type ConversationStatus =
  | 'created' | 'running' | 'paused' | 'done' | 'blocked' | 'failed';

export interface AgentProfile {
  key: string;
  role: string;
  name: string;
  description: string;
  defaultModel: string;
  skills: string[];
  hooks: string[];
  permissions: Record<string, string>;
}

export interface Workspace {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  path: string;
  createdAt: string;
}

export interface Conversation {
  id: string;
  workspaceId: string;
  title: string;
  goal: string;
  strategy: string;
  status: ConversationStatus;
  maxIterations: number;
  parallelDev: number;
  maxParallel: number;
  budgetUsd: number;
  createdAt: string;
  finishedAt: string | null;
}

export interface AgentMessage {
  id: string;
  conversationId: string;
  fromInstance: string;
  toInstances: string[];
  type: string;
  content: string;
  signal: ControlSignal | null;
  artifacts: { path: string; action: string }[];
  tokensIn: number;
  tokensOut: number;
  costEstimate: number;
  ts: string;
}

export interface Metrics {
  messages: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  budgetUsd?: number;
  budgetRemainingUsd?: number | null;
  status?: ConversationStatus;
}

export interface Health {
  ok: boolean;
  opencode: { healthy: boolean; version: string };
}

/** Evento recibido por WebSocket. */
export interface RealtimeEvent {
  event: string;
  payload: any;
}
