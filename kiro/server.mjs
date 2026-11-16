// kiro-runner: ejecuta turnos de agentes con Kiro CLI en modo no interactivo.
//
// API (red interna de Docker, sin publicar al host):
//   POST /turn            {agent, model, cwd, prompt, timeoutMs?} -> {id}   (devuelve al instante)
//   GET  /turn/:id        -> {status: running|done|error|timeout|cancelled, exitCode, text, tools[], ...}
//   POST /turn/:id/cancel -> {cancelled}
//   GET  /health          -> {ok, kiro: <versión>, loggedIn, identity}
//
// El prompt se pasa por stdin (los contextos acumulados pueden superar el límite de argv).
// Cada turno es un proceso `kiro-cli chat --no-interactive --agent <ad-rol> --model <m>`;
// no hay estado entre turnos: el orquestador reenvía el contexto completo.
import http from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.RUNNER_PORT ?? 4097);
const PROJECTS_DIR = process.env.PROJECTS_DIR ?? '/projects';
const MAX_CONCURRENT = Number(process.env.RUNNER_MAX_CONCURRENT ?? 6);
const DEFAULT_TIMEOUT_MS = Number(process.env.RUNNER_TURN_TIMEOUT_MS ?? 20 * 60_000);
const KEEP_MS = 30 * 60_000;
const TOKEN = process.env.RUNNER_TOKEN ?? '';

const MODELS_FILE = process.env.MODELS_FILE ?? '/app/models.json';

/** Lee los perfiles en cada petición (permite editar el fichero sin reiniciar). */
function loadProfiles() {
  try { return JSON.parse(readFileSync(MODELS_FILE, 'utf8')); }
  catch { return { default_profile: null, profiles: {} }; }
}

/**
 * Modelo de un turno. Prioridad: modelo explícito > perfil indicado > perfil por defecto.
 * Si no hay perfil configurado devuelve undefined y Kiro usa el modelo del propio agente.
 */
function resolveModel(role, model, profile) {
  if (model) return { model };
  const cfg = loadProfiles();
  const name = profile || cfg.default_profile;
  if (!name) return { model: undefined };
  const p = cfg.profiles?.[name];
  if (!p) return { error: `perfil de modelos desconocido: ${name}` };
  return { model: p.models?.[role], profile: name };
}

const AGENTS = new Set(['ad-po', 'ad-ux', 'ad-dev', 'ad-validator']);
const MODEL_RE = /^[a-z0-9][a-z0-9.\-_]{0,60}$/i;
const ANSI = /\u001B\[[0-9;?]*[ -/]*[@-~]/g;
const strip = (s) => s.replace(ANSI, '');

/** @type {Map<string, any>} */
const turns = new Map();
let running = 0;

function json(res, code, body) {
  const data = JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) });
  res.end(data);
}

function readBody(req, limit = 4 * 1024 * 1024) {
  return new Promise((ok, fail) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { fail(new Error('body demasiado grande')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => ok(Buffer.concat(chunks).toString('utf8')));
    req.on('error', fail);
  });
}

function withinProjects(p) {
  const r = resolve(p);
  return r === PROJECTS_DIR || r.startsWith(PROJECTS_DIR + '/');
}

function startTurn({ agent, model, cwd, prompt, timeoutMs }) {
  const id = randomUUID();
  const t = {
    id, agent, model, cwd,
    status: 'running', exitCode: null,
    stdout: '', stderr: '', tools: [],
    startedAt: Date.now(), finishedAt: null,
    error: null,
  };
  turns.set(id, t);
  running++;

  const args = ['chat', '--no-interactive', '--agent', agent];
  if (model) args.push('--model', model);

  const child = spawn('kiro-cli', args, {
    cwd,
    env: { ...process.env, NO_COLOR: '1', TERM: 'dumb' },
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: true, // grupo propio para poder matar también los hijos (shell, npm...)
  });
  t.child = child;

  child.stdin.on('error', () => {});
  child.stdin.end(prompt);

  child.stdout.on('data', (d) => { t.stdout += d.toString('utf8'); });
  child.stderr.on('data', (d) => {
    const s = strip(d.toString('utf8'));
    t.stderr += s;
    if (t.stderr.length > 200_000) t.stderr = t.stderr.slice(-200_000);
    for (const line of s.split('\n')) {
      if (line.startsWith('[tool]')) {
        t.tools.push(line.trim());
        if (t.tools.length > 300) t.tools.shift();
      }
    }
  });

  const killGroup = (sig) => { try { process.kill(-child.pid, sig); } catch { /* ya terminó */ } };
  const timer = setTimeout(() => {
    if (t.status === 'running') {
      t.status = 'timeout';
      t.error = `turno abortado por timeout (${timeoutMs} ms)`;
      killGroup('SIGTERM');
      setTimeout(() => killGroup('SIGKILL'), 5000);
    }
  }, timeoutMs);
  t.kill = () => killGroup('SIGTERM');

  child.on('error', (err) => {
    clearTimeout(timer);
    if (t.status === 'running') { t.status = 'error'; t.error = `no se pudo lanzar kiro-cli: ${err.message}`; }
    t.finishedAt = Date.now(); running--;
  });
  child.on('close', (code) => {
    clearTimeout(timer);
    t.exitCode = code;
    if (t.status === 'running') {
      t.status = code === 0 ? 'done' : 'error';
      if (code !== 0) t.error = strip(t.stderr).split('\n').filter(Boolean).slice(-6).join(' | ').slice(0, 800) || `kiro-cli terminó con código ${code}`;
    }
    t.finishedAt = Date.now(); running--;
  });
  return id;
}

function view(t) {
  return {
    id: t.id, status: t.status, exitCode: t.exitCode, error: t.error, agent: t.agent, model: t.model ?? null,
    text: strip(t.stdout).trim(),
    tools: t.tools.slice(-40), toolCount: t.tools.length,
    startedAt: t.startedAt, finishedAt: t.finishedAt,
    elapsedMs: (t.finishedAt ?? Date.now()) - t.startedAt,
  };
}

// --- health (cacheado: whoami lanza un proceso) ---
let healthCache = { at: 0, value: null };
function health() {
  return new Promise((ok) => {
    if (Date.now() - healthCache.at < 30_000 && healthCache.value) return ok(healthCache.value);
    execFile('kiro-cli', ['whoami'], { timeout: 15_000 }, (err, out) => {
      const text = strip(String(out ?? ''));
      const loggedIn = !err && /Logged in/i.test(text);
      const value = {
        ok: true, loggedIn,
        identity: loggedIn ? text.split('\n').find((l) => /Logged in/i.test(l)) ?? null : null,
        running, maxConcurrent: MAX_CONCURRENT,
      };
      healthCache = { at: Date.now(), value };
      ok(value);
    });
  });
}

// --- modelos disponibles (cacheado 10 min; requiere sesión iniciada) ---
let modelsCache = { at: 0, value: null };
function models() {
  return new Promise((ok) => {
    if (Date.now() - modelsCache.at < 600_000 && modelsCache.value) return ok(modelsCache.value);
    execFile('kiro-cli', ['chat', '--list-models', '-f', 'json'], { timeout: 20_000, maxBuffer: 2_000_000 }, (err, out) => {
      try {
        const d = JSON.parse(strip(String(out ?? '')));
        const value = {
          default: d.default_model ?? 'auto',
          models: (d.models ?? []).map((m) => ({
            id: m.model_id, name: m.model_name, description: m.description,
            multiplier: m.rate_multiplier, unit: m.rate_unit, contextTokens: m.context_window_tokens,
          })),
        };
        modelsCache = { at: Date.now(), value };
        ok(value);
      } catch {
        ok({ default: 'auto', models: [], error: err ? String(err.message).slice(0, 200) : 'respuesta no válida' });
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (TOKEN && req.headers.authorization !== `Bearer ${TOKEN}`) return json(res, 401, { error: 'no autorizado' });
    const url = new URL(req.url ?? '/', 'http://x');
    const parts = url.pathname.split('/').filter(Boolean);

    if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, await health());
    if (req.method === 'GET' && url.pathname === '/models') return json(res, 200, await models());
    if (req.method === 'GET' && url.pathname === '/profiles') {
      const cfg = loadProfiles();
      return json(res, 200, {
        default: cfg.default_profile,
        profiles: Object.entries(cfg.profiles ?? {}).map(([name, p]) => ({ name, description: p.description ?? '', models: p.models ?? {} })),
      });
    }

    if (req.method === 'POST' && url.pathname === '/turn') {
      let body;
      try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: 'JSON inválido' }); }
      const { agent, model, profile, cwd, prompt } = body ?? {};
      if (!AGENTS.has(agent)) return json(res, 400, { error: `agente no permitido: ${agent}` });
      if (model && !MODEL_RE.test(model)) return json(res, 400, { error: 'modelo inválido' });
      if (profile && !/^[a-z0-9_-]{1,30}$/i.test(profile)) return json(res, 400, { error: 'perfil inválido' });
      const resolved = resolveModel(agent.replace(/^ad-/, ''), model, profile);
      if (resolved.error) return json(res, 400, { error: resolved.error });
      if (typeof prompt !== 'string' || !prompt.trim()) return json(res, 400, { error: 'prompt requerido' });
      if (typeof cwd !== 'string' || !withinProjects(cwd)) return json(res, 400, { error: `cwd fuera de ${PROJECTS_DIR}` });
      if (!existsSync(cwd) || !statSync(cwd).isDirectory()) return json(res, 400, { error: 'cwd no existe' });
      if (running >= MAX_CONCURRENT) return json(res, 429, { error: 'demasiados turnos en curso' });
      const timeoutMs = Math.min(Number(body.timeoutMs) || DEFAULT_TIMEOUT_MS, 60 * 60_000);
      const id = startTurn({ agent, model: resolved.model, cwd: resolve(cwd), prompt, timeoutMs });
      return json(res, 202, { id, model: resolved.model ?? null, profile: resolved.profile ?? null });
    }

    if (parts[0] === 'turn' && parts[1]) {
      const t = turns.get(parts[1]);
      if (!t) return json(res, 404, { error: 'turno no encontrado' });
      if (req.method === 'GET' && parts.length === 2) return json(res, 200, view(t));
      if (req.method === 'POST' && parts[2] === 'cancel') {
        if (t.status === 'running') { t.status = 'cancelled'; t.error = 'cancelado'; t.kill?.(); }
        return json(res, 200, { cancelled: true });
      }
    }
    json(res, 404, { error: 'no encontrado' });
  } catch (err) {
    json(res, 500, { error: String(err?.message ?? err) });
  }
});

// GC de turnos terminados
setInterval(() => {
  const now = Date.now();
  for (const [id, t] of turns) if (t.finishedAt && now - t.finishedAt > KEEP_MS) turns.delete(id);
}, 60_000).unref();

server.listen(PORT, '0.0.0.0', () => console.log(`[kiro-runner] escuchando en :${PORT}`));
