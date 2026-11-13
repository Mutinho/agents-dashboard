import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const exec = promisify(execFile);

// Raíz de proyectos reales dentro del contenedor (montada desde PROJECTS_ROOT del host).
const PROJECTS_DIR = process.env.PROJECTS_DIR ?? '/projects';

export interface PrepareResult {
  /** Ruta de trabajo dentro del contenedor que verán los agentes. */
  projectPath: string;
  /** Repos efectivamente clonados (URLs). */
  clonedRepos: string[];
  warnings: string[];
}

/** Valida que una URL parece un repo de GitHub público (https). */
export function isGithubUrl(url: string): boolean {
  return /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(\.git)?\/?$/.test(url.trim());
}

/** Deriva el nombre de carpeta del repo a partir de su URL. */
function repoFolder(url: string): string {
  const m = url.trim().replace(/\.git$/, '').replace(/\/$/, '').match(/\/([\w.-]+)$/);
  return m ? m[1] : 'repo';
}

/** Comprueba que una ruta resuelta queda DENTRO de la raíz permitida (anti path-traversal). */
function withinRoot(p: string): boolean {
  const r = resolve(p);
  return r === PROJECTS_DIR || r.startsWith(PROJECTS_DIR + '/');
}

/**
 * Prepara el directorio de trabajo de un workspace según su fuente:
 *  - 'empty': crea /projects/<slug> vacío.
 *  - 'local': usa una subcarpeta existente bajo la raíz permitida.
 *  - 'github': crea /projects/<slug> y clona ahí los repos públicos.
 */
export async function prepareWorkspace(opts: {
  slug: string;
  sourceType: 'empty' | 'local' | 'github';
  repos?: string[];
  localSubpath?: string; // relativo a la raíz permitida (solo 'local')
}): Promise<PrepareResult> {
  const warnings: string[] = [];
  const clonedRepos: string[] = [];

  if (opts.sourceType === 'local') {
    const sub = (opts.localSubpath ?? '').replace(/^\/+/, '');
    const target = join(PROJECTS_DIR, sub);
    if (!withinRoot(target)) {
      throw new Error('La carpeta local está fuera de la raíz permitida');
    }
    try {
      await access(target);
    } catch {
      throw new Error(`La carpeta local no existe: ${sub}`);
    }
    return { projectPath: target, clonedRepos, warnings };
  }

  // 'empty' y 'github': carpeta dedicada del workspace bajo la raíz.
  const base = join(PROJECTS_DIR, opts.slug);
  if (!withinRoot(base)) throw new Error('Ruta de workspace inválida');
  await mkdir(base, { recursive: true });

  if (opts.sourceType === 'github') {
    for (const url of opts.repos ?? []) {
      if (!isGithubUrl(url)) {
        warnings.push(`URL ignorada (no es GitHub público válido): ${url}`);
        continue;
      }
      const dest = join(base, repoFolder(url));
      if (!withinRoot(dest)) {
        warnings.push(`Destino inválido para ${url}`);
        continue;
      }
      try {
        await exec('git', ['clone', '--depth', '1', url, dest], { timeout: 120_000 });
        clonedRepos.push(url);
      } catch (err: any) {
        warnings.push(`No se pudo clonar ${url}: ${err?.stderr ?? err?.message ?? 'error'}`);
      }
    }
  }

  return { projectPath: base, clonedRepos, warnings };
}
