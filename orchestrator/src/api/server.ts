import Fastify from 'fastify';
import cors from '@fastify/cors';
import type { Repos } from '../persistence/repos.js';
import type { OpencodeClient } from '../opencode/client.js';
import { PipelineStrategy } from '../strategies/pipeline.js';

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
    const body = (req.body ?? {}) as { name?: string; description?: string };
    if (!body.name) return reply.code(400).send({ error: 'name requerido' });
    return repos.createWorkspace(body.name, body.description ?? null);
  });

  app.get('/api/workspaces/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ws = await repos.getWorkspace(id);
    if (!ws) return reply.code(404).send({ error: 'no encontrado' });
    const conversations = await repos.listConversations(id);
    return { ...ws, conversations };
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
    };
    if (!body.goal) return reply.code(400).send({ error: 'goal requerido' });
    return repos.createConversation(
      id,
      body.title ?? 'Conversación',
      body.goal,
      body.strategy ?? 'pipeline',
      body.maxIterations ?? 10,
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

  // Lanza la ejecución del pipeline en segundo plano (no bloquea la respuesta).
  app.post('/api/conversations/:id/start', async (req, reply) => {
    const { id } = req.params as { id: string };
    const conv = await repos.getConversation(id);
    if (!conv) return reply.code(404).send({ error: 'no encontrada' });
    if (conv.status === 'running') return reply.code(409).send({ error: 'ya en ejecución' });

    const ws = await repos.getWorkspace(conv.workspaceId);
    const workspacePath = ws?.path ?? '/workspaces';

    const strategy = new PipelineStrategy({ opencode, repos, emit });
    strategy.run(conv, workspacePath).catch(async (err) => {
      app.log.error({ err }, 'pipeline falló');
      await repos.setConversationStatus(id, 'failed').catch(() => {});
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
