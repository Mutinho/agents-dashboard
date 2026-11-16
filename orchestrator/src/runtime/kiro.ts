import { randomUUID } from 'node:crypto';
import type { AgentRole, TurnResult } from '../domain/types.js';
import { parseSignal } from '../strategies/signals.js';
import type { AgentRuntime, PromptOptions } from './types.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface KiroModel {
  id: string; name: string; description: string;
  multiplier: number; unit: string; contextTokens: number;
}
export interface KiroProfile {
  name: string;
  description: string;
  /** modelo por rol: po / ux / dev / validator */
  models: Record<string, string>;
}
export interface KiroStatus {
  available: boolean;       // el runner responde
  loggedIn: boolean;        // hay sesión de Kiro iniciada en el contenedor
  identity: string | null;
  defaultModel: string;
  models: KiroModel[];
  profiles: KiroProfile[];
  defaultProfile: string | null;
  error?: string;
}

/**
 * Motor Kiro CLI: delega cada turno en el servicio `kiro-runner` (contenedor `kiro`),
 * que ejecuta `kiro-cli chat --no-interactive --agent ad-<rol>`. Mismo patrón que OpenCode:
 * lanzar -> sondear hasta terminar (sin conexiones HTTP largas).
 * Los turnos no tienen estado: el pipeline ya reenvía el contexto completo.
 */
export class KiroRuntime implements AgentRuntime {
  readonly kind = 'kiro' as const;

  constructor(private readonly baseUrl: string, private readonly token?: string) {}

  private headers(): Record<string, string> {
    return { 'Content-Type': 'application/json', ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) };
  }

  /** No hay sesión persistente: devolvemos un id único por rol/instancia. */
  async createSession(_title: string, role?: AgentRole): Promise<string> {
    return `kiro:${role ?? 'agent'}:${randomUUID().slice(0, 8)}`;
  }

  async status(): Promise<KiroStatus> {
    const empty: KiroStatus = { available: false, loggedIn: false, identity: null, defaultModel: 'auto', models: [], profiles: [], defaultProfile: null };
    try {
      const h = await fetch(`${this.baseUrl}/health`, { headers: this.headers(), signal: AbortSignal.timeout(20_000) });
      if (!h.ok) return { ...empty, error: `runner HTTP ${h.status}` };
      const health: any = await h.json();
      if (!health.loggedIn) return { ...empty, available: true, error: 'Kiro no tiene sesión iniciada en el contenedor (make kiro-login)' };
      const m = await fetch(`${this.baseUrl}/models`, { headers: this.headers(), signal: AbortSignal.timeout(30_000) });
      const md: any = m.ok ? await m.json() : { default: 'auto', models: [] };
      const pr = await fetch(`${this.baseUrl}/profiles`, { headers: this.headers(), signal: AbortSignal.timeout(15_000) });
      const pd: any = pr.ok ? await pr.json() : { default: null, profiles: [] };
      return {
        available: true, loggedIn: true, identity: health.identity ?? null,
        defaultModel: md.default ?? 'auto', models: md.models ?? [],
        profiles: pd.profiles ?? [], defaultProfile: pd.default ?? null,
      };
    } catch (err: any) {
      return { ...empty, error: `runner no accesible: ${err?.message ?? err}` };
    }
  }

  async prompt(_sessionId: string, role: AgentRole, text: string, opts: PromptOptions = {}): Promise<TurnResult> {
    const fail = (error: string): TurnResult => ({ text: '', signal: null, tokensIn: 0, tokensOut: 0, cost: 0, error });
    const timeoutMs = Number(process.env.TURN_TIMEOUT_MS ?? 15 * 60_000);
    const pollMs = Number(process.env.TURN_POLL_MS ?? 3000);
    if (!opts.cwd) return fail('Kiro necesita un directorio de trabajo (cwd)');

    // 1) lanzar el turno (vuelve al instante)
    let id: string;
    try {
      const r = await fetch(`${this.baseUrl}/turn`, {
        method: 'POST', headers: this.headers(),
        body: JSON.stringify({ agent: `ad-${role}`, model: opts.model || undefined, profile: opts.profile || undefined, cwd: opts.cwd, prompt: text, timeoutMs }),
        signal: AbortSignal.timeout(30_000),
      });
      const body: any = await r.json().catch(() => ({}));
      if (!r.ok) return fail(`kiro-runner rechazó el turno: ${body?.error ?? `HTTP ${r.status}`}`);
      id = body.id;
    } catch (err: any) {
      return fail(`kiro-runner no accesible: ${err?.message ?? err}`);
    }

    // 2) sondear hasta que termine (tope de seguridad = timeout del turno + margen)
    const deadline = Date.now() + timeoutMs + 60_000;
    let consecutiveErrors = 0;
    while (Date.now() < deadline) {
      await sleep(pollMs);
      try {
        const r = await fetch(`${this.baseUrl}/turn/${id}`, { headers: this.headers(), signal: AbortSignal.timeout(15_000) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const t: any = await r.json();
        consecutiveErrors = 0;
        if (t.status === 'running') continue;

        const textOut: string = t.text ?? '';
        if (t.status !== 'done') {
          return { ...fail(t.error ?? `turno en estado ${t.status}`), text: textOut };
        }
        const { signal } = parseSignal(textOut);
        // Kiro CLI no expone tokens ni créditos por turno: se registran como "no medido" (0).
        return { text: textOut, signal, tokensIn: 0, tokensOut: 0, cost: 0, error: null };
      } catch (err: any) {
        if (++consecutiveErrors >= 10) return fail(`se perdió la conexión con kiro-runner: ${err?.message ?? err}`);
      }
    }
    // tope agotado: intentar cancelar y reportar
    fetch(`${this.baseUrl}/turn/${id}/cancel`, { method: 'POST', headers: this.headers() }).catch(() => {});
    return fail(`turno abortado por timeout (${timeoutMs} ms)`);
  }
}
