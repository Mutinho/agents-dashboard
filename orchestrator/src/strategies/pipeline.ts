import type { AgentRole, Conversation, ControlSignal } from '../domain/types.js';
import type { OpencodeClient } from '../opencode/client.js';
import type { Repos } from '../persistence/repos.js';
import { isTerminal } from './signals.js';

export interface PipelineDeps {
  opencode: OpencodeClient;
  repos: Repos;
  /** callback para emitir eventos en vivo (WS). */
  emit?: (event: string, payload: unknown) => void;
}

/** Orden fijo de etapas del pipeline v1 (PLAN §4.4). */
const PIPELINE: AgentRole[] = ['po', 'ux', 'dev', 'validator'];

const ROLE_NAME: Record<AgentRole, string> = {
  po: 'Product Owner',
  ux: 'UX',
  dev: 'Developer',
  validator: 'Validador',
};

/**
 * Estrategia "pipeline fijo": recorre PO -> UX -> Dev -> Validador.
 * - Cada agente puede auto-descartarse con [SKIP] (se pasa a la siguiente etapa).
 * - El Validador cierra con [APPROVED] (done) o [CHANGES] (vuelve a Dev).
 * - [BLOCKED] pausa la conversación.
 * - maxIterations acota el número total de turnos para evitar loops infinitos.
 */
export class PipelineStrategy {
  constructor(private readonly deps: PipelineDeps) {}

  async run(conversation: Conversation, workspacePath = '/workspaces'): Promise<void> {
    const { opencode, repos, emit } = this.deps;
    const cid = conversation.id;

    await repos.setConversationStatus(cid, 'running');
    emit?.('conversation.status', { conversationId: cid, status: 'running' });

    // Crea una sesión OpenCode por rol (instancia única por rol en v1).
    const sessions = new Map<AgentRole, string>();
    for (const role of PIPELINE) {
      const sid = await opencode.createSession(`${conversation.title} · ${role}`);
      sessions.set(role, sid);
      await repos.upsertParticipant(cid, role, role, sid);
    }

    // Contexto compartido que se pasa de etapa a etapa.
    let context =
      `# Objetivo del proyecto\n${conversation.goal}\n\n` +
      `> Directorio de trabajo asignado: \`${workspacePath}\`. ` +
      `Crea y edita TODOS los ficheros dentro de ese directorio; no trabajes fuera de él.\n`;
    let iteration = 0;
    let stageIndex = 0;
    let lastValidatorFeedback = '';

    while (iteration < conversation.maxIterations) {
      iteration += 1;
      const role = PIPELINE[stageIndex];
      const sessionId = sessions.get(role)!;

      const prompt = this.buildPrompt(role, context, lastValidatorFeedback);
      emit?.('turn.started', { conversationId: cid, role, iteration });

      const result = await opencode.prompt(sessionId, role, prompt);

      // Persistir el turno como mensaje.
      await repos.addMessage({
        conversationId: cid,
        fromInstance: role,
        toInstances: [],
        type: role === 'validator' ? 'review' : 'result',
        content: result.text,
        signal: result.signal,
        artifacts: [],
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        costEstimate: result.cost,
      });
      emit?.('message.created', {
        conversationId: cid,
        role,
        signal: result.signal,
        cost: result.cost,
      });

      if (result.error) {
        await repos.setConversationStatus(cid, 'failed');
        emit?.('conversation.status', { conversationId: cid, status: 'failed', error: result.error });
        return;
      }

      // Acumular la salida al contexto (salvo SKIP, que no aporta entregable).
      if (result.signal !== 'SKIP') {
        context += `\n---\n## Aportación de ${ROLE_NAME[role]}\n${result.text}\n`;
      }

      const next = this.decideNext(role, result.signal, stageIndex);

      if (next.terminal) {
        await repos.setConversationStatus(cid, next.status!);
        emit?.('conversation.status', { conversationId: cid, status: next.status });
        return;
      }

      if (role === 'validator' && result.signal === 'CHANGES') {
        lastValidatorFeedback = result.text;
      }
      stageIndex = next.stageIndex!;
    }

    // Se agotaron las iteraciones sin [APPROVED].
    await repos.setConversationStatus(cid, 'paused');
    emit?.('conversation.status', {
      conversationId: cid,
      status: 'paused',
      reason: 'maxIterations alcanzado',
    });
  }

  /** Construye el prompt de una etapa a partir del contexto acumulado. */
  private buildPrompt(role: AgentRole, context: string, feedback: string): string {
    if (role === 'validator') {
      return (
        `${context}\n---\n` +
        `Valida los entregables contra los criterios de aceptación definidos por el PO. ` +
        `Si todo se cumple responde [APPROVED]; si falta algo responde [CHANGES] con la lista concreta.`
      );
    }
    if (role === 'dev' && feedback) {
      return (
        `${context}\n---\n` +
        `El Validador pidió cambios:\n${feedback}\n\n` +
        `Aplica las correcciones necesarias.`
      );
    }
    return (
      `${context}\n---\n` +
      `Es tu turno como ${ROLE_NAME[role]}. Aporta tu parte o descártate con [SKIP] si no procede.`
    );
  }

  /** Decide la siguiente etapa según la señal (máquina de estados del pipeline). */
  private decideNext(
    role: AgentRole,
    signal: ControlSignal | null,
    stageIndex: number,
  ): { terminal: boolean; status?: 'done' | 'blocked'; stageIndex?: number } {
    if (signal === 'BLOCKED') return { terminal: true, status: 'blocked' };

    if (role === 'validator') {
      if (signal === 'APPROVED') return { terminal: true, status: 'done' };
      // CHANGES (o cualquier otra) -> volver a Dev.
      return { terminal: false, stageIndex: PIPELINE.indexOf('dev') };
    }

    // PO / UX / Dev: avanzar a la siguiente etapa (tanto en DONE como en SKIP).
    return { terminal: false, stageIndex: stageIndex + 1 };
  }
}
