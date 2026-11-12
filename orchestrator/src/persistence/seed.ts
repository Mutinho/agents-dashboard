import type { Repos } from './repos.js';

// Metadatos de los 4 agentes para el dashboard (skills/hooks/permiso visibles).
// Refleja lo montado en config/opencode/agents/*.md y las skills asignadas por rol.
const MODEL = 'openrouter/deepseek/deepseek-v4.1-flash-1017';

export async function seedProfiles(repos: Repos): Promise<void> {
  await repos.upsertProfile({
    key: 'po',
    role: 'po',
    name: 'Product Owner',
    description: 'Convierte el objetivo en historias con criterios de aceptación y decide el "done".',
    defaultModel: MODEL,
    skills: ['doc-coauthoring'],
    hooks: [],
    permissions: { edit: 'deny', bash: 'deny', webfetch: 'allow' },
  });

  await repos.upsertProfile({
    key: 'ux',
    role: 'ux',
    name: 'UX',
    description: 'Diseño de experiencia e interfaz; se auto-descarta si la tarea no tiene UI.',
    defaultModel: MODEL,
    skills: ['ui-ux-pro-max', 'frontend-design'],
    hooks: [],
    permissions: { edit: 'allow', bash: 'deny', webfetch: 'allow' },
  });

  await repos.upsertProfile({
    key: 'dev',
    role: 'dev',
    name: 'Developer',
    description: 'Implementa las historias en el workspace, escribe y ejecuta tests.',
    defaultModel: 'openrouter/minimax/minimax-m3',
    skills: ['webapp-testing'],
    hooks: [],
    permissions: { edit: 'allow', bash: 'deny', webfetch: 'allow' },
  });

  await repos.upsertProfile({
    key: 'validator',
    role: 'validator',
    name: 'Validador',
    description: 'Revisa entregables contra criterios y emite veredicto [APPROVED]/[CHANGES].',
    defaultModel: MODEL,
    skills: ['web-design-guidelines', 'webapp-testing'],
    hooks: [],
    permissions: { edit: 'deny', bash: 'deny', webfetch: 'allow' },
  });
}
