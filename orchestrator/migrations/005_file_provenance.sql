-- Trazabilidad de ficheros: qué conversación creó/modificó cada fichero del workspace.
-- Se rellena comparando el estado del workspace antes y después de cada conversación.

CREATE TABLE IF NOT EXISTS file_provenance (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  rel_path        TEXT NOT NULL,
  action          TEXT NOT NULL DEFAULT 'modified', -- created | modified
  ts              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, rel_path, conversation_id)
);

CREATE INDEX IF NOT EXISTS idx_fileprov_workspace ON file_provenance(workspace_id);
