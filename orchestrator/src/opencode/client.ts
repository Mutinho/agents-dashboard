import { createOpencodeClient } from '@opencode-ai/sdk';
import { Agent, setGlobalDispatcher } from 'undici';
import type { AgentRole, TurnResult } from '../domain/types.js';
import { parseSignal } from '../strategies/signals.js';

// Los turnos de agentes (escribir ficheros, ejecutar tests) pueden durar varios
// minutos. El fetch nativo de Node (undici) aborta a los ~5 min por defecto
// (HeadersTimeoutError). Ampliamos los timeouts para soportar turnos largos.
setGlobalDispatcher(
  new Agent({
    headersTimeout: 30 * 60_000, // 30 min
    bodyTimeout: 30 * 60_000,
    connectTimeout: 60_000,
  }),
);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface OpencodeConfig {
  baseUrl: string;
  username?: string;
  password?: string;
}

type Client = ReturnType<typeof createOpencodeClient>;

/**
 * Envoltura del SDK de OpenCode para el orquestador.
 * Cada AgentInstance se respalda con una sesión de OpenCode; el orquestador
 * crea la sesión, envía prompts dirigidos a un agente concreto y lee la
 * respuesta (texto + señal de control + métricas).
 */
export class OpencodeClient {
  private readonly client: Client;

  constructor(cfg: OpencodeConfig) {
    const authHeader =
      cfg.username !== undefined
        ? 'Basic ' +
          Buffer.from(`${cfg.username}:${cfg.password ?? ''}`).toString('base64')
        : undefined;

    this.client = createOpencodeClient({
      baseUrl: cfg.baseUrl,
      fetch: (url: any, opts: any = {}) => {
        if (authHeader) {
          opts.headers = { ...(opts.headers ?? {}), Authorization: authHeader };
        }
        return fetch(url, opts);
      },
    });
  }

  /** Salud del server. */
  async health(): Promise<{ healthy: boolean; version: string }> {
    const r: any = await (this.client as any)._client.get({ url: '/global/health' });
    return r.data ?? r;
  }

  /** Crea una sesión de OpenCode y devuelve su id. */
  async createSession(title: string): Promise<string> {
    const r: any = await this.client.session.create({ body: { title } });
    const s = r.data ?? r;
    return s.id as string;
  }

  /**
   * Envía un prompt a un agente en modo ASÍNCRONO y sondea el estado de la
   * sesión hasta que queda idle (patrón que soporta turnos largos sin que el
   * timeout de conexión HTTP los aborte). Al terminar, lee el último mensaje
   * del asistente y devuelve texto + señal + métricas.
   *
   * `TURN_TIMEOUT_MS` sigue actuando como tope de seguridad (si el turno no
   * acaba en ese tiempo, se marca error) pero ya no corta una conexión viva:
   * el trabajo del agente puede durar lo que necesite dentro de ese límite.
   */
  async prompt(
    sessionId: string,
    agent: AgentRole,
    text: string,
  ): Promise<TurnResult> {
    const timeoutMs = Number(process.env.TURN_TIMEOUT_MS ?? 15 * 60_000);
    const pollMs = Number(process.env.TURN_POLL_MS ?? 3000);

    // 1) Lanzar el prompt en modo async (vuelve enseguida).
    try {
      await (this.client as any).session.promptAsync({
        path: { id: sessionId },
        body: { agent, parts: [{ type: 'text', text }] },
      });
    } catch (err: any) {
      return { text: '', signal: null, tokensIn: 0, tokensOut: 0, cost: 0, error: err?.message ?? 'error al lanzar prompt_async' };
    }

    // 2) Sondear el estado de la sesión hasta que quede idle (o timeout).
    const deadline = Date.now() + timeoutMs;
    // margen inicial para que la sesión pase a 'busy' antes de comprobar idle
    await sleep(Math.min(pollMs, 1500));
    while (Date.now() < deadline) {
      let busy = false;
      try {
        const st: any = await (this.client as any).session.status();
        const map = st.data ?? st ?? {};
        busy = map?.[sessionId]?.type === 'busy';
      } catch {
        /* fallo transitorio al consultar estado: reintenta */
      }
      if (!busy) break;
      await sleep(pollMs);
    }
    if (Date.now() >= deadline) {
      return { text: '', signal: null, tokensIn: 0, tokensOut: 0, cost: 0, error: `turno abortado por timeout (${timeoutMs} ms)` };
    }

    // 3) Leer el último mensaje del asistente de la sesión.
    let msgs: any[];
    try {
      const r: any = await (this.client as any).session.messages({ path: { id: sessionId } });
      msgs = (r.data ?? r) as any[];
    } catch (err: any) {
      return { text: '', signal: null, tokensIn: 0, tokensOut: 0, cost: 0, error: err?.message ?? 'error al leer mensajes' };
    }

    const assistants = (msgs ?? []).filter((m) => (m.info?.role ?? m.role) === 'assistant');
    const last = assistants[assistants.length - 1];
    if (!last) {
      return { text: '', signal: null, tokensIn: 0, tokensOut: 0, cost: 0, error: 'sin respuesta del asistente' };
    }
    const info = last.info ?? last;
    const parts: any[] = last.parts ?? [];

    const fullText = parts
      .filter((p) => p?.type === 'text' && typeof p.text === 'string')
      .map((p) => p.text)
      .join('\n')
      .trim();

    const tokens = info.tokens ?? {};
    const { signal } = parseSignal(fullText);

    return {
      text: fullText,
      signal,
      tokensIn: tokens.input ?? 0,
      tokensOut: tokens.output ?? 0,
      cost: info.cost ?? 0,
      error: info.error ? (info.error?.data?.message ?? 'unknown error') : null,
    };
  }

  /** Lista de agentes disponibles (para validar que po/ux/dev/validator existen). */
  async agents(): Promise<string[]> {
    const r: any = await (this.client as any).app.agents();
    const list = (r?.data ?? r) as any[];
    return Array.isArray(list) ? list.map((a) => a.name) : [];
  }
}
