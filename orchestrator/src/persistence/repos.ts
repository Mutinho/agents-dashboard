import { randomUUID } from 'node:crypto';
import type { Pool } from './db.js';
import type {
  AgentMessage,
  Conversation,
  ConversationStatus,
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
  async createWorkspace(name: string, description: string | null): Promise<Workspace> {
    const wid = id('ws');
    const slug = `${slugify(name)}-${wid.slice(-4)}`;
    const path = `/workspaces/${slug}`;
    const { rows } = await this.pool.query(
      `INSERT INTO workspaces(id, slug, name, description, path)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [wid, slug, name, description, path],
    );
    return this.mapWorkspace(rows[0]);
  }

  async listWorkspaces(): Promise<Workspace[]> {
    const { rows } = await this.pool.query('SELECT * FROM workspaces ORDER BY created_at DESC');
    return rows.map(this.mapWorkspace);
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
  ): Promise<Conversation> {
    const cid = id('conv');
    const { rows } = await this.pool.query(
      `INSERT INTO conversations(id, workspace_id, title, goal, strategy, max_iterations, parallel_dev, max_parallel)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [cid, workspaceId, title, goal, strategy, maxIterations, parallelDev, maxParallel],
    );
    return this.mapConversation(rows[0]);
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
    createdAt: r.created_at?.toISOString?.() ?? String(r.created_at),
    finishedAt: r.finished_at?.toISOString?.() ?? null,
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
