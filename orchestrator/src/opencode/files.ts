import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve, relative, extname } from 'node:path';

const PROJECTS_DIR = process.env.PROJECTS_DIR ?? '/projects';

// Carpetas ruidosas que no interesa mostrar en el inspector.
const IGNORE = new Set(['.git', 'node_modules', 'dist', '.angular', '__pycache__', '.cache']);
const MAX_FILE_BYTES = 512 * 1024; // 512 KB para lectura inline

export interface FileNode {
  name: string;
  path: string; // relativo al projectPath
  type: 'dir' | 'file';
  size?: number;
  children?: FileNode[];
}

/** Garantiza que una ruta queda dentro del projectPath (anti path-traversal). */
function safeJoin(projectPath: string, rel: string): string {
  const base = resolve(projectPath);
  const target = resolve(base, rel.replace(/^\/+/, ''));
  if (target !== base && !target.startsWith(base + '/')) {
    throw new Error('Ruta fuera del workspace');
  }
  return target;
}

/** Árbol de ficheros del workspace (recursivo, acotado en profundidad). */
export async function listTree(projectPath: string, maxDepth = 6): Promise<FileNode[]> {
  async function walk(dir: string, depth: number): Promise<FileNode[]> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const nodes: FileNode[] = [];
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (IGNORE.has(e.name)) continue;
      const abs = join(dir, e.name);
      const rel = relative(projectPath, abs);
      if (e.isDirectory()) {
        nodes.push({
          name: e.name,
          path: rel,
          type: 'dir',
          children: depth < maxDepth ? await walk(abs, depth + 1) : [],
        });
      } else if (e.isFile()) {
        let size: number | undefined;
        try { size = (await stat(abs)).size; } catch { /* ignore */ }
        nodes.push({ name: e.name, path: rel, type: 'file', size });
      }
    }
    // carpetas primero, luego ficheros
    return nodes.sort((a, b) => (a.type === b.type ? 0 : a.type === 'dir' ? -1 : 1));
  }
  return walk(projectPath, 0);
}

export interface FileContent {
  path: string;
  size: number;
  binary: boolean;
  content: string | null; // texto si no es binario y < límite
  language: string;       // pista para el resaltado/render
}

const TEXT_EXT = new Set([
  '.md', '.txt', '.json', '.js', '.ts', '.tsx', '.jsx', '.html', '.css', '.scss',
  '.py', '.java', '.go', '.rs', '.rb', '.php', '.sh', '.yml', '.yaml', '.xml',
  '.sql', '.env', '.toml', '.ini', '.csv', '.vue', '.svelte', '',
]);

/** Lee el contenido de un fichero del workspace (inline, con guardas). */
export async function readFileContent(projectPath: string, rel: string): Promise<FileContent> {
  const abs = safeJoin(projectPath, rel);
  const s = await stat(abs);
  if (!s.isFile()) throw new Error('No es un fichero');
  const ext = extname(abs).toLowerCase();
  const looksText = TEXT_EXT.has(ext);
  if (!looksText || s.size > MAX_FILE_BYTES) {
    return { path: rel, size: s.size, binary: true, content: null, language: ext.slice(1) };
  }
  const content = await readFile(abs, 'utf8');
  return { path: rel, size: s.size, binary: false, content, language: ext.slice(1) || 'text' };
}

/** Ruta absoluta validada (para descarga por stream). */
export function resolveFile(projectPath: string, rel: string): string {
  return safeJoin(projectPath, rel);
}

/**
 * Snapshot plano de los ficheros del workspace: mapa rel_path -> mtimeMs.
 * Se usa antes/después de una conversación para detectar creados/modificados.
 */
export async function snapshot(projectPath: string): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 8) return;
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (IGNORE.has(e.name)) continue;
      const abs = join(dir, e.name);
      if (e.isDirectory()) await walk(abs, depth + 1);
      else if (e.isFile()) {
        try { map.set(relative(projectPath, abs), (await stat(abs)).mtimeMs); } catch { /* ignore */ }
      }
    }
  }
  await walk(projectPath, 0);
  return map;
}

/** Diferencia dos snapshots -> ficheros creados o modificados. */
export function diffSnapshots(
  before: Map<string, number>,
  after: Map<string, number>,
): { path: string; action: 'created' | 'modified' }[] {
  const changes: { path: string; action: 'created' | 'modified' }[] = [];
  for (const [path, mtime] of after) {
    if (!before.has(path)) changes.push({ path, action: 'created' });
    else if (before.get(path) !== mtime) changes.push({ path, action: 'modified' });
  }
  return changes;
}
