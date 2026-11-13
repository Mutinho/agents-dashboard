import { randomUUID } from 'node:crypto';
import type { Pool } from './db.js';
import type {
  AgentMessage,
  Conversation,
  ConversationStatus,
  Metrics,
  Workspace,
} from '../domain/types.js';

function id(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'workspace';
}

export class Repos {
  constructor(private readonly pool: Pool) {}

  // ---- Workspaces ----
  /** Genera un slug único para un nombre (lo usa la API antes de clonar). */
  makeWorkspaceIds(name: string): { id: string; slug: string } {
    const wid = id('ws');
    return { id: wid, slug: `${slugify(name)}-${wid.slice(-4)}` };
  }

  async createWorkspace(opts: {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    sourceType: string;
    repos: string[];
    projectPath: string | null;
  }): Promise<Workspace> {
    // 'path' legacy = projectPath real si existe, si no la carpeta interna.
    const path = opts.projectPath ?? `/workspaces/${opts.slug}`;
    const { rows } = await this.pool.query(
      `INSERT INTO workspaces(id, slug, name, description, path, source_type, repos, project_path)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [opts.id, opts.slug, opts.name, opts.description, path,
       opts.sourceType, JSON.stringify(opts.repos), opts.projectPath],
    );
    return this.mapWorkspace(rows[0]);
  }

  async listWorkspaces(): Promise<Workspace[]> {
    const { rows } = await this.pool.query('SELECT * FROM workspaces ORDER BY created_at DESC');
    return rows.map(this.mapWorkspace);
  }

  /** Elimina un workspace (cascade: conversaciones, participantes y mensajes). */
  async deleteWorkspace(wid: string): Promise<boolean> {
    const res = await this.pool.query('DELETE FROM workspaces WHERE id=$1', [wid]);
    return (res.rowCount ?? 0) > 0;
  }

  // ---- Trazabilidad de ficheros ----
  async recordFileChanges(
    workspaceId: string,
    conversationId: string,
    changes: { path: string; action: 'created' | 'modified' }[],
  ): Promise<void> {
    for (const c of changes) {
      await this.pool.query(
        `INSERT INTO file_provenance(id, workspace_id, conversation_id, rel_path, action)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (workspace_id, rel_path, conversation_id)
         DO UPDATE SET action = EXCLUDED.action, ts = now()`,
        [id('fp'), workspaceId, conversationId, c.path, c.action],
      );
    }
  }

  /** Mapa rel_path -> info de la última conversación que lo tocó (para el inspector). */
  async fileProvenance(workspaceId: string): Promise<Record<string, { conversationId: string | null; action: string; ts: string }>> {
    const { rows } = await this.pool.query(
      `SELECT DISTINCT ON (rel_path) rel_path, conversation_id, action, ts
       FROM file_provenance WHERE workspace_id=$1
       ORDER BY rel_path, ts DESC`,
      [workspaceId],
    );
    const out: Record<string, any> = {};
    for (const r of rows) {
      out[r.rel_path] = {
        conversationId: r.conversation_id,
        action: r.action,
        ts: r.ts?.toISOString?.() ?? String(r.ts),
      };
    }
    return out;
  }

  /** Lista de artefactos (ficheros generados/modificados por conversaciones) de un workspace. */
  async listArtifacts(workspaceId: string): Promise<
    { relPath: string; conversationId: string | null; action: string; ts: string }[]
  > {
    const { rows } = await this.pool.query(
      `SELECT DISTINCT ON (rel_path) rel_path, conversation_id, action, ts
       FROM file_provenance WHERE workspace_id=$1
       ORDER BY rel_path, ts DESC`,
      [workspaceId],
    );
    return rows.map((r) => ({
      relPath: r.rel_path,
      conversationId: r.conversation_id,
      action: r.action,
      ts: r.ts?.toISOString?.() ?? String(r.ts),
    }));
  }

  async getWorkspace(wid: string): Promise<Workspace | null> {
    const { rows } = await this.pool.query('SELECT * FROM workspaces WHERE id=$1', [wid]);
    return rows[0] ? this.mapWorkspace(rows[0]) : null;
  }

  // ---- Conversations ----
  async createConversation(
    workspaceId: string,
    title: string,
    goal: string,
    strategy: string,
    maxIterations: number,
    parallelDev = 1,
    maxParallel = 2,
    budgetUsd = 0,
  ): Promise<Conversation> {
    const cid = id('conv');
    const { rows } = await this.pool.query(
      `INSERT INTO conversations(id, workspace_id, title, goal, strategy, max_iterations, parallel_dev, max_parallel, budget_usd)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [cid, workspaceId, title, goal, strategy, maxIterations, parallelDev, maxParallel, budgetUsd],
    );
    return this.mapConversation(rows[0]);
  }

  /** Agregados de coste/tokens de una conversación (desde messages). */
  async conversationMetrics(conversationId: string): Promise<Metrics> {
    const { rows } = await this.pool.query(
      `SELECT COUNT(*)::int AS messages,
              COALESCE(SUM(tokens_in),0)::int  AS tokens_in,
              COALESCE(SUM(tokens_out),0)::int AS tokens_out,
              COALESCE(SUM(cost_estimate),0)   AS cost_usd
       FROM messages WHERE conversation_id = $1`,
      [conversationId],
    );
    return this.mapMetrics(rows[0]);
  }

  /** Agregados de coste/tokens de todo un workspace (todas sus conversaciones). */
  async workspaceMetrics(workspaceId: string): Promise<Metrics> {
    const { rows } = await this.pool.query(
      `SELECT COUNT(m.*)::int AS messages,
              COALESCE(SUM(m.tokens_in),0)::int  AS tokens_in,
              COALESCE(SUM(m.tokens_out),0)::int AS tokens_out,
              COALESCE(SUM(m.cost_estimate),0)   AS cost_usd
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE c.workspace_id = $1`,
      [workspaceId],
    );
    return this.mapMetrics(rows[0]);
  }

  async getConversation(cid: string): Promise<Conversation | null> {
    const { rows } = await this.pool.query('SELECT * FROM conversations WHERE id=$1', [cid]);
    return rows[0] ? this.mapConversation(rows[0]) : null;
  }

  async listConversations(workspaceId: string): Promise<Conversation[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM conversations WHERE workspace_id=$1 ORDER BY created_at DESC',
      [workspaceId],
    );
    return rows.map(this.mapConversation);
  }

  async setConversationStatus(cid: string, status: ConversationStatus): Promise<void> {
    const finished = ['done', 'blocked', 'failed'].includes(status);
    await this.pool.query(
      `UPDATE conversations SET status=$2${finished ? ', finished_at=now()' : ''} WHERE id=$1`,
      [cid, status],
    );
  }

  // ---- Participants ----
  async upsertParticipant(
    conversationId: string,
    profileKey: string,
    instanceLabel: string,
    opencodeSessionId: string | null,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO conversation_participants(id, conversation_id, profile_key, instance_label, opencode_session_id)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (conversation_id, instance_label)
       DO UPDATE SET opencode_session_id = EXCLUDED.opencode_session_id`,
      [id('part'), conversationId, profileKey, instanceLabel, opencodeSessionId],
    );
  }

  // ---- Messages ----
  async addMessage(m: Omit<AgentMessage, 'id' | 'ts'>): Promise<AgentMessage> {
    const mid = id('msg');
    const { rows } = await this.pool.query(
      `INSERT INTO messages(id, conversation_id, from_instance, to_instances, type, content,
                            signal, artifacts, tokens_in, tokens_out, cost_estimate)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        mid,
        m.conversationId,
        m.fromInstance,
        JSON.stringify(m.toInstances),
        m.type,
        m.content,
        m.signal,
        JSON.stringify(m.artifacts),
        m.tokensIn,
        m.tokensOut,
        m.costEstimate,
      ],
    );
    return this.mapMessage(rows[0]);
  }

  async listMessages(conversationId: string): Promise<AgentMessage[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM messages WHERE conversation_id=$1 ORDER BY ts ASC',
      [conversationId],
    );
    return rows.map(this.mapMessage);
  }

  // ---- Agent profiles ----
  async listProfiles(): Promise<any[]> {
    const { rows } = await this.pool.query('SELECT * FROM agent_profiles ORDER BY key');
    return rows;
  }

  async upsertProfile(p: {
    key: string;
    role: string;
    name: string;
    description: string;
    defaultModel: string;
    skills: string[];
    hooks: string[];
    permissions: Record<string, string>;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO agent_profiles(key, role, name, description, default_model, skills, hooks, permissions)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (key) DO UPDATE SET
         role=EXCLUDED.role, name=EXCLUDED.name, description=EXCLUDED.description,
         default_model=EXCLUDED.default_model, skills=EXCLUDED.skills, hooks=EXCLUDED.hooks,
         permissions=EXCLUDED.permissions, updated_at=now()`,
      [
        p.key,
        p.role,
        p.name,
        p.description,
        p.defaultModel,
        JSON.stringify(p.skills),
        JSON.stringify(p.hooks),
        JSON.stringify(p.permissions),
      ],
    );
  }

  // ---- mappers ----
  private mapWorkspace = (r: any): Workspace => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description,
    path: r.path,
    sourceType: r.source_type ?? 'empty',
    repos: r.repos ?? [],
    projectPath: r.project_path ?? null,
    createdAt: r.created_at?.toISOString?.() ?? String(r.created_at),
  });

  private mapConversation = (r: any): Conversation => ({
    id: r.id,
    workspaceId: r.workspace_id,
    title: r.title,
    goal: r.goal,
    strategy: r.strategy,
    status: r.status,
    maxIterations: r.max_iterations,
    parallelDev: r.parallel_dev ?? 1,
    maxParallel: r.max_parallel ?? 2,
    budgetUsd: Number(r.budget_usd ?? 0),
    createdAt: r.created_at?.toISOString?.() ?? String(r.created_at),
    finishedAt: r.finished_at?.toISOString?.() ?? null,
  });

  private mapMetrics = (r: any): Metrics => ({
    messages: Number(r.messages ?? 0),
    tokensIn: Number(r.tokens_in ?? 0),
    tokensOut: Number(r.tokens_out ?? 0),
    costUsd: Number(r.cost_usd ?? 0),
  });

  private mapMessage = (r: any): AgentMessage => ({
    id: r.id,
    conversationId: r.conversation_id,
    fromInstance: r.from_instance,
    toInstances: r.to_instances ?? [],
    type: r.type,
    content: r.content,
    signal: r.signal,
    artifacts: r.artifacts ?? [],
    tokensIn: r.tokens_in,
    tokensOut: r.tokens_out,
    costEstimate: Number(r.cost_estimate),
    ts: r.ts?.toISOString?.() ?? String(r.ts),
  });
}
