-- Fase 5: presupuesto por conversación (freno de coste).
-- El coste proviene de OpenRouter/OpenCode y está en USD; usamos USD como unidad
-- coherente (sin conversión de moneda falsa). 0 = sin límite.

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS budget_usd DOUBLE PRECISION NOT NULL DEFAULT 0;
