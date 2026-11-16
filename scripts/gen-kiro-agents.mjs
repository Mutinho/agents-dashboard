#!/usr/bin/env node
// Genera los agentes de Kiro CLI (config/kiro/agents/ad-*.json) a partir de los
// agentes de OpenCode (config/opencode/agents/*.md), que siguen siendo la fuente
// de verdad de prompts y descripciones. Los permisos por rol se definen aquí.
//
// Uso: node scripts/gen-kiro-agents.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'config/opencode/agents');
const OUT = join(root, 'config/kiro/agents');
mkdirSync(OUT, { recursive: true });

// Rutas dentro del contenedor kiro (montadas desde PROJECTS_ROOT).
const PROJECTS = '/projects';

// Permisos por rol. Equivalen a los de OpenCode: PO sin escritura ni shell,
// UX escribe pero sin shell, Dev escribe y usa shell (sin push/rm -rf/sudo),
// Validador no escribe y usa shell solo para comprobaciones no destructivas.
const ROLES = {
  po: {
    tools: ['read', 'grep', 'glob'],
    toolsSettings: {},
  },
  ux: {
    tools: ['read', 'grep', 'glob', 'write'],
    toolsSettings: {
      write: { allowedPaths: [`${PROJECTS}/**`], deniedPaths: [`${PROJECTS}/**/.git/**`] },
    },
  },
  dev: {
    tools: ['read', 'grep', 'glob', 'write', 'shell'],
    toolsSettings: {
      write: { allowedPaths: [`${PROJECTS}/**`], deniedPaths: [`${PROJECTS}/**/.git/**`] },
      shell: {
        deniedCommands: ['git push.*', 'rm -rf.*', 'sudo .*'],
        autoAllowReadonly: true,
      },
    },
  },
  validator: {
    tools: ['read', 'grep', 'glob', 'shell'],
    toolsSettings: {
      shell: {
        deniedCommands: [
          'git (push|commit|checkout|switch|reset|merge|rebase|stash|clean|restore|add|rm|mv)( .*)?',
          'git tag (-d|-f|--delete).*',
          'git branch (-d|-D|-m|-M|--delete).*',
          'rm .*', 'mv .*', 'sudo .*',
          'npm (install|i|ci|uninstall|update).*',
        ],
        autoAllowReadonly: true,
      },
    },
  },
};

// Preámbulo común: adapta el vocabulario de herramientas de OpenCode a Kiro.
const KIRO_NOTE =
  'NOTA DE ENTORNO: trabajas con las herramientas de Kiro (`read`, `write`, `grep`, `glob`, `shell`). ' +
  'Donde estas instrucciones mencionen `edit`, usa `write`. Cuando se hable de una herramienta `skill`, ' +
  'usa las skills que Kiro tenga disponibles si aplican. El resto de reglas (señales de control, ' +
  'uso real de herramientas, no inventar acciones) se aplican igual.\n\n';

function parse(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) throw new Error('frontmatter no encontrado');
  const front = m[1];
  const desc = (front.match(/^description:\s*(.+)$/m) || [])[1] ?? '';
  return { description: desc.trim(), body: m[2].trim() };
}

for (const [role, cfg] of Object.entries(ROLES)) {
  const { description, body } = parse(readFileSync(join(SRC, `${role}.md`), 'utf8'));
  const agent = {
    name: `ad-${role}`,
    description,
    prompt: KIRO_NOTE + body,
    tools: cfg.tools,
    allowedTools: cfg.tools,
    toolsSettings: cfg.toolsSettings,
  };
  writeFileSync(join(OUT, `ad-${role}.json`), JSON.stringify(agent, null, 2) + '\n');
  console.log(`ad-${role}.json  tools=[${cfg.tools.join(',')}]  prompt=${agent.prompt.length} chars`);
}
