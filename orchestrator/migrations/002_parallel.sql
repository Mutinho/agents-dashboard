-- Fase 4: configuración de paralelismo por conversación.

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS parallel_dev  INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS max_parallel  INTEGER NOT NULL DEFAULT 2;
