-- Workspaces con directorio de trabajo real y fuente de código.
-- source_type: 'empty' (crea de cero), 'local' (carpeta existente bajo la raíz),
--              'github' (uno o varios repos públicos clonados).
-- repos: lista de URLs de GitHub clonadas (jsonb).
-- project_path: ruta del directorio de trabajo DENTRO del contenedor (/projects/... o /workspaces/...).

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS source_type  TEXT NOT NULL DEFAULT 'empty',
  ADD COLUMN IF NOT EXISTS repos        JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS project_path TEXT;
