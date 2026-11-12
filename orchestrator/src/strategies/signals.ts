import type { ControlSignal } from '../domain/types.js';

const SIGNALS: ControlSignal[] = ['APPROVED', 'CHANGES', 'DONE', 'SKIP', 'BLOCKED'];

export interface ParsedSignal {
  signal: ControlSignal | null;
  /** Texto que acompaña a la señal (p.ej. el motivo de [SKIP]). */
  detail: string | null;
}

/**
 * Extrae la señal de control del texto de un turno (PLAN §4.4).
 * Reglas:
 *  - Se busca el patrón [SEÑAL] opcionalmente seguido de un detalle.
 *  - Si hay varias, gana la ÚLTIMA aparición (el agente cierra su turno con ella).
 *  - APPROVED/CHANGES tienen prioridad semántica del Validador, pero la posición
 *    (última) es la que manda para no malinterpretar menciones en el cuerpo.
 */
export function parseSignal(text: string): ParsedSignal {
  if (!text) return { signal: null, detail: null };

  const regex = /\[(APPROVED|CHANGES|DONE|SKIP|BLOCKED)\]([^\n\r]*)/gi;
  let match: RegExpExecArray | null;
  let last: { signal: ControlSignal; detail: string | null } | null = null;

  while ((match = regex.exec(text)) !== null) {
    const signal = match[1].toUpperCase() as ControlSignal;
    if (!SIGNALS.includes(signal)) continue;
    const detail = match[2]?.trim() || null;
    last = { signal, detail };
  }

  if (!last) return { signal: null, detail: null };
  return { signal: last.signal, detail: last.detail };
}

/** ¿Es una señal terminal de la conversación? */
export function isTerminal(signal: ControlSignal | null): boolean {
  return signal === 'APPROVED' || signal === 'BLOCKED';
}
