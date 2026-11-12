import type { AgentRole, Conversation, ControlSignal, TurnResult } from '../domain/types.js';
import type { OpencodeClient } from '../opencode/client.js';
import type { Repos } from '../persistence/repos.js';

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
  private devInstances: { label: string; sessionId: string }[] = [];

  constructor(private readonly deps: PipelineDeps) {}

  async run(conversation: Conversation, workspacePath = '/workspaces'): Promise<void> {
    const { opencode, repos, emit } = this.deps;
    const cid = conversation.id;

    await repos.setConversationStatus(cid, 'running');
    emit?.('conversation.status', { conversationId: cid, status: 'running' });

    // Crea una sesión OpenCode por rol. Para Dev en paralelo, crea N instancias
    // (dev#1..devN) además de la sesión base "dev".
    const sessions = new Map<AgentRole, string>();
    for (const role of PIPELINE) {
      const sid = await opencode.createSession(`${conversation.title} · ${role}`);
      sessions.set(role, sid);
      await repos.upsertParticipant(cid, role, role, sid);
    }

    const devInstances: { label: string; sessionId: string }[] = [];
    if (conversation.parallelDev > 1) {
      for (let i = 1; i <= conversation.parallelDev; i++) {
        const label = `dev#${i}`;
        const sid = await opencode.createSession(`${conversation.title} · ${label}`);
        devInstances.push({ label, sessionId: sid });
        await repos.upsertParticipant(cid, 'dev', label, sid);
      }
    }
    this.devInstances = devInstances;

    // Contexto compartido que se pasa de etapa a etapa.
    let context =
      `# Objetivo del proyecto\n${conversation.goal}\n\n` +
      `> Directorio de trabajo asignado: \`${workspacePath}\`. ` +
      `Crea y edita TODOS los ficheros dentro de ese directorio; no trabajes fuera de él.\n`;
    let iteration = 0;
    let stageIndex = 0;
    let lastValidatorFeedback = '';
    let spentUsd = 0;

    while (iteration < conversation.maxIterations) {
      iteration += 1;
      const role = PIPELINE[stageIndex];

      emit?.('turn.started', { conversationId: cid, role, iteration });

      // Etapa Dev con posible paralelismo; el resto, turno único.
      const result =
        role === 'dev' && conversation.parallelDev > 1
          ? await this.runDevStageParallel(conversation, sessions, context, lastValidatorFeedback)
          : await this.runSingleTurn(conversation, role, sessions.get(role)!, context, lastValidatorFeedback);

      if (result.error) {
        await repos.setConversationStatus(cid, 'failed');
        emit?.('conversation.status', { conversationId: cid, status: 'failed', error: result.error });
        return;
      }

      // Métricas: acumular coste del turno y emitir cost.update.
      spentUsd += result.cost;
      emit?.('cost.update', {
        conversationId: cid,
        role,
        turnCostUsd: result.cost,
        spentUsd,
        budgetUsd: conversation.budgetUsd,
      });

      // Freno de presupuesto: si hay límite y se supera, pausar la conversación.
      if (conversation.budgetUsd > 0 && spentUsd >= conversation.budgetUsd) {
        await repos.setConversationStatus(cid, 'paused');
        emit?.('budget.exceeded', {
          conversationId: cid,
          spentUsd,
          budgetUsd: conversation.budgetUsd,
        });
        emit?.('conversation.status', {
          conversationId: cid,
          status: 'paused',
          reason: `presupuesto superado ($${spentUsd.toFixed(4)} ≥ $${conversation.budgetUsd})`,
        });
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

  /** Ejecuta un turno simple (un agente, una sesión) y persiste el mensaje. */
  private async runSingleTurn(
    conversation: Conversation,
    role: AgentRole,
    sessionId: string,
    context: string,
    feedback: string,
  ): Promise<TurnResult> {
    const { opencode, repos, emit } = this.deps;
    const prompt = this.buildPrompt(role, context, feedback);
    const result = await opencode.prompt(sessionId, role, prompt);

    await repos.addMessage({
      conversationId: conversation.id,
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
      conversationId: conversation.id,
      role,
      instance: role,
      signal: result.signal,
      cost: result.cost,
    });
    return result;
  }

  /**
   * Etapa Dev PARALELA (PLAN §4.5): reparte el trabajo entre N instancias
   * (dev#1..devN) que corren en paralelo, limitadas por maxParallel, y junta
   * sus resultados. Cada instancia persiste su propio mensaje (from = dev#i).
   * La señal agregada es DONE si todas terminan (DONE/SKIP) sin BLOCKED.
   */
  private async runDevStageParallel(
    conversation: Conversation,
    _sessions: Map<AgentRole, string>,
    context: string,
    feedback: string,
  ): Promise<TurnResult> {
    const { opencode, repos, emit } = this.deps;
    const n = this.devInstances.length;
    const limit = Math.max(1, Math.min(conversation.maxParallel, n));

    // Prompt por instancia: cada Dev toma la subtarea i de n (auto-reparto).
    const makePrompt = (idx: number): string => {
      const base = feedback
        ? `${context}\n---\nEl Validador pidió cambios:\n${feedback}\n`
        : `${context}\n`;
      return (
        `${base}\n---\n` +
        `Sois ${n} desarrolladores trabajando EN PARALELO. Eres **dev#${idx + 1}** de ${n}.\n` +
        `Divide mentalmente el trabajo en ${n} partes coherentes y ocúpate SOLO de la parte ${idx + 1}.\n` +
        `Coordínate por convención (no te pises con otras partes); escribe solo los ficheros de tu parte.\n` +
        `Si tu parte no requiere trabajo, responde [SKIP].`
      );
    };

    // Ejecuta con límite de concurrencia (pool simple).
    const results: TurnResult[] = new Array(n);
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < n) {
        const i = next++;
        const inst = this.devInstances[i];
        emit?.('turn.started', { conversationId: conversation.id, role: 'dev', instance: inst.label });
        const r = await opencode.prompt(inst.sessionId, 'dev', makePrompt(i));
        results[i] = r;
        await repos.addMessage({
          conversationId: conversation.id,
          fromInstance: inst.label,
          toInstances: [],
          type: 'result',
          content: r.text,
          signal: r.signal,
          artifacts: [],
          tokensIn: r.tokensIn,
          tokensOut: r.tokensOut,
          costEstimate: r.cost,
        });
        emit?.('message.created', {
          conversationId: conversation.id,
          role: 'dev',
          instance: inst.label,
          signal: r.signal,
          cost: r.cost,
        });
      }
    };
    await Promise.all(Array.from({ length: limit }, () => worker()));

    // Agregar resultados. Tolerante a fallos: si alguna instancia da error pero
    // al menos una produjo trabajo, continuamos (no tumbamos la conversación).
    const errored = results.filter((r) => r.error);
    const allErrored = errored.length === results.length;
    const anyBlocked = results.some((r) => r.signal === 'BLOCKED');
    const allSkip = results.every((r) => r.signal === 'SKIP');
    const aggregatedText = results
      .map((r, i) => `### dev#${i + 1}\n${r.error ? `(error: ${r.error})` : r.text}`)
      .join('\n\n');

    return {
      text: aggregatedText,
      signal: anyBlocked ? 'BLOCKED' : allSkip ? 'SKIP' : 'DONE',
      tokensIn: results.reduce((a, r) => a + r.tokensIn, 0),
      tokensOut: results.reduce((a, r) => a + r.tokensOut, 0),
      cost: results.reduce((a, r) => a + r.cost, 0),
      error: allErrored ? (errored[0]?.error ?? 'todas las instancias Dev fallaron') : null,
    };
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
