-- Motor de agentes por conversación: 'opencode' (OpenRouter) o 'kiro' (Kiro CLI).
-- model: modelo opcional para el motor (en Kiro, p.ej. 'claude-sonnet-5.5'; NULL = por defecto).
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS runtime TEXT NOT NULL DEFAULT 'opencode',
  ADD COLUMN IF NOT EXISTS model   TEXT;
