#!/usr/bin/env bash
# Login de Kiro CLI dentro del contenedor `kiro` mediante device flow (sin navegador en el contenedor).
# Muestra un código y una URL que debes abrir y aprobar en tu navegador. Las credenciales quedan en
# el volumen kiro_data (persisten al recrear el contenedor). Es independiente de la sesión del host.
#
# Datos de Identity Center (licencia Pro): se leen de KIRO_START_URL / KIRO_REGION (.env),
# o, si no están, de `kiro-cli whoami` del host. Para Builder ID (licencia free) deja KIRO_LICENSE=free.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] && set -a && . ./.env && set +a
[ -f .env.local ] && set -a && . ./.env.local && set +a

C=ad-kiro
docker ps --format '{{.Names}}' | grep -qx "$C" || { echo "El contenedor $C no está en marcha: make up-kiro"; exit 1; }

if docker exec "$C" kiro-cli whoami >/dev/null 2>&1; then
  echo "Ya hay sesión iniciada en el contenedor:"; docker exec "$C" kiro-cli whoami | head -2; exit 0
fi

LICENSE="${KIRO_LICENSE:-pro}"
if [ "$LICENSE" = "pro" ]; then
  START_URL="${KIRO_START_URL:-}"; REGION="${KIRO_REGION:-}"
  if [ -z "$START_URL" ] && command -v kiro-cli >/dev/null; then
    J=$(kiro-cli whoami --format json 2>/dev/null | head -1 || true)
    START_URL=$(printf '%s' "$J" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("startUrl",""))' 2>/dev/null || true)
    REGION=$(printf '%s' "$J" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("region",""))' 2>/dev/null || true)
  fi
  [ -n "$START_URL" ] && [ -n "$REGION" ] || { echo "Falta KIRO_START_URL / KIRO_REGION (Identity Center) en .env"; exit 1; }
  CMD="kiro-cli login --license pro --identity-provider $START_URL --region $REGION --use-device-flow"
else
  CMD="kiro-cli login --license free --use-device-flow"
fi

docker exec "$C" sh -c 'rm -f /tmp/login.log'
# script da un pseudo-terminal; los Enter confirman los valores precargados de los prompts
docker exec -d "$C" sh -c "nohup sh -c '(sleep 4; printf \"\\n\"; sleep 4; printf \"\\n\"; sleep 4; printf \"\\n\"; sleep 840) | script -qefc \"$CMD\" /tmp/login.log' >/dev/null 2>&1 &"

echo "Generando código de login..."
for _ in $(seq 1 20); do
  sleep 2
  OUT=$(docker exec "$C" sh -c 'tr "\r" "\n" < /tmp/login.log 2>/dev/null | sed "s/\x1b\[[0-9;?]*[A-Za-z]//g" | grep -E "Code:|Open this URL|https://" || true')
  if printf '%s' "$OUT" | grep -q "Code:"; then
    echo; echo "$OUT" | grep -E "Code:|Open this URL" | sed 's/^/  /'
    echo; echo "Abre la URL en tu navegador y confirma el código (caduca en ~10 min). Esperando aprobación..."
    break
  fi
done
for _ in $(seq 1 60); do
  if docker exec "$C" kiro-cli whoami >/dev/null 2>&1; then
    echo "Login correcto:"; docker exec "$C" kiro-cli whoami | head -2; exit 0
  fi
  sleep 10
done
echo "No se completó el login a tiempo. Vuelve a ejecutar make kiro-login."; exit 1
