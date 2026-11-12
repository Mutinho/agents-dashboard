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
   * Envía un prompt a un agente dentro de una sesión y espera la respuesta
   * completa (modo síncrono). Devuelve texto, señal y métricas.
   */
  async prompt(
    sessionId: string,
    agent: AgentRole,
    text: string,
  ): Promise<TurnResult> {
    const r: any = await this.client.session.prompt({
      path: { id: sessionId },
      body: { agent, parts: [{ type: 'text', text }] },
    });
    const res = r.data ?? r;
    const info = res.info ?? {};
    const parts: any[] = res.parts ?? [];

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
      error: info.error ? info.error?.data?.message ?? 'unknown error' : null,
    };
  }

  /** Lista de agentes disponibles (para validar que po/ux/dev/validator existen). */
  async agents(): Promise<string[]> {
    const r: any = await (this.client as any).app.agents();
    const list = (r?.data ?? r) as any[];
    return Array.isArray(list) ? list.map((a) => a.name) : [];
  }
}
