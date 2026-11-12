// Modelo de dominio del orquestador multi-agente.
// Refleja PLAN.md §4.1 (conceptos) y §4.6 (persistencia).

/** Roles del pipeline fijo (PLAN §5.1). */
export type AgentRole = 'po' | 'ux' | 'dev' | 'validator';

/** Señales de control que un agente emite al final de su turno (PLAN §4.4). */
export type ControlSignal = 'DONE' | 'SKIP' | 'CHANGES' | 'APPROVED' | 'BLOCKED';

/** Estrategias de orquestación. v1 implementa solo 'pipeline'. */
export type Strategy = 'pipeline' | 'round-robin' | 'blackboard';

export type ConversationStatus =
  | 'created'
  | 'running'
  | 'paused'
  | 'done'
  | 'blocked'
  | 'failed';

export type MessageType =
  | 'task'
  | 'question'
  | 'result'
  | 'review'
  | 'decision'
  | 'system';

/** Espacio / proyecto de trabajo. */
export interface Workspace {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  path: string; // directorio físico bajo /workspaces
  createdAt: string;
}

/** Definición de un rol de agente (metadato; la ejecución la hace OpenCode). */
export interface AgentProfile {
  key: AgentRole;
  role: AgentRole;
  name: string;
  description: string;
  systemPrompt: string | null;
  defaultModel: string;
  skills: string[]; // ids de skills asignadas (para el dashboard)
  hooks: string[]; // ids de hooks (para el dashboard)
  permissions: Record<string, string>;
}

/** Instancia viva de un AgentProfile dentro de una conversación. */
export interface AgentInstance {
  id: string;
  conversationId: string;
  profileKey: AgentRole;
  instanceLabel: string; // p.ej. "dev#1"
  opencodeSessionId: string | null;
}

/** Conversación multi-agente con un objetivo. */
export interface Conversation {
  id: string;
  workspaceId: string;
  title: string;
  goal: string;
  strategy: Strategy;
  status: ConversationStatus;
  maxIterations: number;
  /** Nº de instancias del rol Dev a ejecutar en paralelo (1 = secuencial). */
  parallelDev: number;
  /** Límite de concurrencia real (tope de instancias simultáneas). */
  maxParallel: number;
  createdAt: string;
  finishedAt: string | null;
}

/** Intervención de un agente (o del humano / sistema). */
export interface AgentMessage {
  id: string;
  conversationId: string;
  fromInstance: string; // instanceLabel o 'human'/'system'
  toInstances: string[];
  type: MessageType;
  content: string;
  signal: ControlSignal | null;
  artifacts: Artifact[];
  tokensIn: number;
  tokensOut: number;
  costEstimate: number;
  ts: string;
}

export interface Artifact {
  path: string;
  action: 'created' | 'modified' | 'deleted';
}

/** Resultado de ejecutar el turno de un agente en OpenCode. */
export interface TurnResult {
  text: string;
  signal: ControlSignal | null;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  error: string | null;
}
