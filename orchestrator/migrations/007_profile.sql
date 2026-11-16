-- Perfil de modelos de Kiro por conversación (equilibrado / economico / maxima...).
-- NULL = perfil por defecto del runner (config/kiro/models.json). `model` (006) sigue siendo
-- un modelo único que, si existe, tiene prioridad sobre el perfil.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS profile TEXT;
