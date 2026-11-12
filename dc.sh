#!/usr/bin/env bash
# Wrapper de docker compose con cascada de entorno .env -> .env.local
#
# Carga .env (base) y, si existe, .env.local (overrides que GANAN). Esto aplica
# tanto a la interpolación ${...} del docker-compose.yml como al entorno de los
# contenedores, de forma consistente.
#
# Uso:
#   ./dc.sh up -d opencode
#   ./dc.sh --profile full up -d
#   ./dc.sh ps
#   ./dc.sh logs -f opencode
set -euo pipefail

cd "$(dirname "$0")"

ARGS=(--env-file .env)
if [ -f .env.local ]; then
  ARGS+=(--env-file .env.local)
fi

exec docker compose "${ARGS[@]}" "$@"
