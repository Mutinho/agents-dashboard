import Fastify from 'fastify';
import cors from '@fastify/cors';
import type { Repos } from '../persistence/repos.js';
import type { OpencodeClient } from '../opencode/client.js';
import { PipelineStrategy } from '../strategies/pipeline.js';
import { prepareWorkspace } from '../opencode/projects.js';
import { readFileContent, resolveFile } from '../opencode/files.js';
import { readFile, stat } from 'node:fs/promises';

export interface ApiDeps {
  repos: Repos;
  opencode: OpencodeClient;
  emit: (event: string, payload: unknown) => void;
}

export function buildApi(deps: ApiDeps) {
  const app = Fastify({ logger: true });
  app.register(cors, { origin: true });

  const { repos, opencode, emit } = deps;

  app.get('/api/health', async () => {
    const oc = await opencode.health().catch(() => ({ healthy: false, version: '?' }));
    return { ok: true, opencode: oc };
  });

  app.get('/api/agents', async () => repos.listProfiles());

  // ---- Workspaces ----
  app.get('/api/workspaces', async () => repos.listWorkspaces());

  app.post('/api/workspaces', async (req, reply) => {
    const body = (req.body ?? {}) as {
      name?: string;
      description?: string;
      sourceType?: 'empty' | 'local' | 'github';
      repos?: string[];
      localSubpath?: string;
    };
    if (!body.name) return reply.code(400).send({ error: 'name requerido' });

    const sourceType = body.sourceType ?? 'empty';
    const { id, slug } = repos.makeWorkspaceIds(body.name);

    // Prepara el directorio real (crea/clona). Si falla el clonado grave, devuelve 400.
    let prepared;
    try {
      prepared = await prepareWorkspace({
        slug,
        sourceType,
        repos: body.repos ?? [],
        localSubpath: body.localSubpath,
      });
    } catch (err: any) {
      return reply.code(400).send({ error: err?.message ?? 'no se pudo preparar el workspace' });
    }

    const ws = await repos.createWorkspace({
      id,
      slug,
      name: body.name,
      description: body.description ?? null,
      sourceType,
      repos: prepared.clonedRepos,
      projectPath: prepared.projectPath,
    });
    return { ...ws, warnings: prepared.warnings };
  });

  app.get('/api/workspaces/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ws = await repos.getWorkspace(id);
    if (!ws) return reply.code(404).send({ error: 'no encontrado' });
    const conversations = await repos.listConversations(id);
    return { ...ws, conversations };
  });

  // Elimina el workspace y sus conversaciones/mensajes (cascade en DB).
  // NO borra los ficheros/repos del disco (se conservan en PROJECTS_ROOT).
  app.delete('/api/workspaces/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ok = await repos.deleteWorkspace(id);
    if (!ok) return reply.code(404).send({ error: 'no encontrado' });
    return { deleted: true };
  });

  // Artefactos del workspace: SOLO los ficheros generados/modificados por
  // conversaciones (no el árbol completo del repo clonado). Cada uno con su
  // conversación de origen y tamaño actual en disco.
  app.get('/api/workspaces/:id/files', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ws = await repos.getWorkspace(id);
    if (!ws) return reply.code(404).send({ error: 'no encontrado' });
    const base = ws.projectPath ?? ws.path;
    const artifacts = await repos.listArtifacts(id).catch(() => []);
    // Enriquecer con tamaño y existencia; descartar los que ya no existen.
    const files = [];
    for (const a of artifacts) {
      try {
        const abs = resolveFile(base, a.relPath);
        const s = await stat(abs);
        if (s.isFile()) {
          files.push({
            path: a.relPath,
            size: s.size,
            conversationId: a.conversationId,
            action: a.action,
            ts: a.ts,
          });
        }
      } catch {
        /* el artefacto fue borrado del disco: no se lista */
      }
    }
    files.sort((x, y) => (x.ts < y.ts ? 1 : -1)); // más recientes primero
    return { files };
  });

  // Contenido de un fichero del workspace (inline, con guardas).
  app.get('/api/workspaces/:id/file', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { path: rel } = req.query as { path?: string };
    if (!rel) return reply.code(400).send({ error: 'path requerido' });
    const ws = await repos.getWorkspace(id);
    if (!ws) return reply.code(404).send({ error: 'no encontrado' });
    const base = ws.projectPath ?? ws.path;
    try {
      return await readFileContent(base, rel);
    } catch (err: any) {
      return reply.code(400).send({ error: err?.message ?? 'no se pudo leer' });
    }
  });

  // Descarga de un fichero del workspace.
  app.get('/api/workspaces/:id/download', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { path: rel } = req.query as { path?: string };
    if (!rel) return reply.code(400).send({ error: 'path requerido' });
    const ws = await repos.getWorkspace(id);
    if (!ws) return reply.code(404).send({ error: 'no encontrado' });
    const base = ws.projectPath ?? ws.path;
    try {
      const abs = resolveFile(base, rel);
      const data = await readFile(abs);
      const name = rel.split('/').pop() ?? 'file';
      reply.header('Content-Disposition', `attachment; filename="${name}"`);
      reply.header('Content-Type', 'application/octet-stream');
      return reply.send(data);
    } catch (err: any) {
      return reply.code(400).send({ error: err?.message ?? 'no se pudo descargar' });
    }
  });

  // ---- Conversations ----
  app.post('/api/workspaces/:id/conversations', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ws = await repos.getWorkspace(id);
    if (!ws) return reply.code(404).send({ error: 'workspace no encontrado' });
    const body = (req.body ?? {}) as {
      title?: string;
      goal?: string;
      strategy?: string;
      maxIterations?: number;
      parallelDev?: number;
      maxParallel?: number;
      budgetUsd?: number;
    };
    if (!body.goal) return reply.code(400).send({ error: 'goal requerido' });
    return repos.createConversation(
      id,
      body.title ?? 'Conversación',
      body.goal,
      body.strategy ?? 'pipeline',
      body.maxIterations ?? 10,
      body.parallelDev ?? 1,
      body.maxParallel ?? 2,
      body.budgetUsd ?? 0,
    );
  });

  app.get('/api/conversations/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const conv = await repos.getConversation(id);
    if (!conv) return reply.code(404).send({ error: 'no encontrada' });
    return conv;
  });

  app.get('/api/conversations/:id/messages', async (req) => {
    const { id } = req.params as { id: string };
    return repos.listMessages(id);
  });

  // Métricas agregadas de una conversación (coste/tokens + presupuesto).
  app.get('/api/conversations/:id/metrics', async (req, reply) => {
    const { id } = req.params as { id: string };
    const conv = await repos.getConversation(id);
    if (!conv) return reply.code(404).send({ error: 'no encontrada' });
    const metrics = await repos.conversationMetrics(id);
    return {
      ...metrics,
      budgetUsd: conv.budgetUsd,
      budgetRemainingUsd: conv.budgetUsd > 0 ? Math.max(0, conv.budgetUsd - metrics.costUsd) : null,
      status: conv.status,
    };
  });

  // Métricas agregadas de todo un workspace.
  app.get('/api/workspaces/:id/metrics', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ws = await repos.getWorkspace(id);
    if (!ws) return reply.code(404).send({ error: 'workspace no encontrado' });
    return repos.workspaceMetrics(id);
  });

  // Lanza la ejecución del pipeline en segundo plano (no bloquea la respuesta).
  app.post('/api/conversations/:id/start', async (req, reply) => {
    const { id } = req.params as { id: string };
    const conv = await repos.getConversation(id);
    if (!conv) return reply.code(404).send({ error: 'no encontrada' });
    if (conv.status === 'running') return reply.code(409).send({ error: 'ya en ejecución' });

    const ws = await repos.getWorkspace(conv.workspaceId);
    const workspacePath = ws?.projectPath ?? ws?.path ?? '/workspaces';

    const strategy = new PipelineStrategy({ opencode, repos, emit });
    strategy.run(conv, workspacePath).catch(async (err) => {
      app.log.error({ err }, 'pipeline falló');
      // Mensaje de sistema visible + marcar failed (no dejar huérfana en running).
      await repos
        .addMessage({
          conversationId: id,
          fromInstance: 'system',
          toInstances: [],
          type: 'system',
          content: `⚠️ La conversación se detuvo por un error inesperado: ${err?.message ?? err}`,
          signal: null,
          artifacts: [],
          tokensIn: 0,
          tokensOut: 0,
          costEstimate: 0,
        })
        .catch(() => {});
      await repos.setConversationStatus(id, 'failed').catch(() => {});
      emit('conversation.status', { conversationId: id, status: 'failed' });
    });
    return { started: true, conversationId: id };
  });

  app.post('/api/conversations/:id/stop', async (req, reply) => {
    const { id } = req.params as { id: string };
    const conv = await repos.getConversation(id);
    if (!conv) return reply.code(404).send({ error: 'no encontrada' });
    await repos.setConversationStatus(id, 'paused');
    return { stopped: true };
  });

  return app;
}
