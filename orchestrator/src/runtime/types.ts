import type { AgentRole, TurnResult } from '../domain/types.js';

export type RuntimeKind = 'opencode' | 'kiro';

export interface PromptOptions {
  /** Directorio de trabajo del turno (ruta dentro del contenedor del motor). */
  cwd?: string;
  /** Modelo a usar (solo motores que lo admiten por turno, p.ej. Kiro). */
  model?: string | null;
  /** Perfil de modelos por rol (solo Kiro). Ignorado si hay `model`. */
  profile?: string | null;
}

/**
 * Motor de agentes: abstrae OpenCode y Kiro para que el pipeline no dependa de ninguno.
 * Un "turno" es una intervención completa de un rol (con sus herramientas) que devuelve
 * texto, señal de control y métricas.
 */
export interface AgentRuntime {
  readonly kind: RuntimeKind;
  /** Crea (o reserva) una sesión para un rol/instancia y devuelve su id. */
  createSession(title: string, role?: AgentRole): Promise<string>;
  /** Ejecuta un turno y espera a que termine. Nunca lanza: los fallos van en `TurnResult.error`. */
  prompt(sessionId: string, role: AgentRole, text: string, opts?: PromptOptions): Promise<TurnResult>;
}
