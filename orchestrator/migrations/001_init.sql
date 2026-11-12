-- Esquema de dominio del orquestador (PLAN §4.6). Postgres 16, jsonb nativo.

CREATE TABLE IF NOT EXISTS workspaces (
  id          TEXT PRIMARY KEY,
  slug        TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  path        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_profiles (
  key            TEXT PRIMARY KEY,
  role           TEXT NOT NULL,
  name           TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  system_prompt  TEXT,
  default_model  TEXT NOT NULL,
  skills         JSONB NOT NULL DEFAULT '[]',
  hooks          JSONB NOT NULL DEFAULT '[]',
  permissions    JSONB NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversations (
  id             TEXT PRIMARY KEY,
  workspace_id   TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  goal           TEXT NOT NULL,
  strategy       TEXT NOT NULL DEFAULT 'pipeline',
  status         TEXT NOT NULL DEFAULT 'created',
  max_iterations INTEGER NOT NULL DEFAULT 10,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS conversation_participants (
  id                   TEXT PRIMARY KEY,
  conversation_id      TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  profile_key          TEXT NOT NULL,
  instance_label       TEXT NOT NULL,
  opencode_session_id  TEXT,
  UNIQUE (conversation_id, instance_label)
);

CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  from_instance   TEXT NOT NULL,
  to_instances    JSONB NOT NULL DEFAULT '[]',
  type            TEXT NOT NULL DEFAULT 'system',
  content         TEXT NOT NULL DEFAULT '',
  signal          TEXT,
  artifacts       JSONB NOT NULL DEFAULT '[]',
  tokens_in       INTEGER NOT NULL DEFAULT 0,
  tokens_out      INTEGER NOT NULL DEFAULT 0,
  cost_estimate   DOUBLE PRECISION NOT NULL DEFAULT 0,
  ts              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, ts);
CREATE INDEX IF NOT EXISTS idx_participants_conversation ON conversation_participants(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversations_workspace ON conversations(workspace_id);
