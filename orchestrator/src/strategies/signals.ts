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

/**
 * Extrae el PLAN de ejecución que declara el PO: `[PLAN] ux, dev, validator`.
 * Devuelve la secuencia de roles válidos (sin el PO, que ya ha hablado).
 * Garantiza que el Validador cierra siempre. Si no hay plan válido, null
 * (el orquestador usará el pipeline por defecto).
 */
export function parsePlan(text: string): ('ux' | 'dev' | 'validator')[] | null {
  if (!text) return null;
  const m = text.match(/\[PLAN\]\s*([^\n\r]+)/i);
  if (!m) return null;
  const valid = ['ux', 'dev', 'validator'] as const;
  const seq = m[1]
    .toLowerCase()
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((s): s is 'ux' | 'dev' | 'validator' => (valid as readonly string[]).includes(s));
  if (seq.length === 0) return null;
  // dedup preservando orden
  const out: ('ux' | 'dev' | 'validator')[] = [];
  for (const r of seq) if (!out.includes(r)) out.push(r);
  // el Validador siempre cierra
  if (!out.includes('validator')) out.push('validator');
  else {
    out.splice(out.indexOf('validator'), 1);
    out.push('validator');
  }
  return out;
}
