// Helpers de presentación compartidos por las pantallas.

export function roleColor(role: string): string {
  return `var(--role-${role}, var(--color-muted-foreground))`;
}

export function roleLabel(role: string): string {
  const base = role.split('#')[0];
  const map: Record<string, string> = {
    po: 'Product Owner', ux: 'UX', dev: 'Developer', validator: 'Validador',
  };
  const label = map[base] ?? base;
  return role.includes('#') ? `${label} ${role.slice(role.indexOf('#'))}` : label;
}

export function signalColor(signal: string | null): string {
  if (!signal) return 'var(--color-muted-foreground)';
  return `var(--signal-${signal.toLowerCase()}, var(--color-muted-foreground))`;
}

export function statusColor(status: string): string {
  const map: Record<string, string> = {
    running: 'var(--signal-changes)',
    done: 'var(--signal-done)',
    approved: 'var(--signal-approved)',
    paused: 'var(--signal-skip)',
    blocked: 'var(--signal-blocked)',
    failed: 'var(--color-destructive)',
    created: 'var(--color-muted-foreground)',
  };
  return map[status] ?? 'var(--color-muted-foreground)';
}

export function usd(n: number | undefined | null): string {
  if (n == null) return '—';
  return '$' + n.toFixed(4);
}
