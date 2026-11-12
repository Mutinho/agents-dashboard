# Atajos para gestionar la infra con cascada de entorno (.env -> .env.local).
# Todos los targets usan ./dc.sh, que aplica --env-file .env --env-file .env.local.

DC := ./dc.sh

.PHONY: help up up-full down ps logs restart-opencode build health

help:
	@echo "Targets:"
	@echo "  make up               Levanta solo opencode"
	@echo "  make up-full          Levanta todo (opencode + db + broker)"
	@echo "  make down             Para y elimina los contenedores"
	@echo "  make ps               Estado de los servicios"
	@echo "  make logs             Logs de opencode (follow)"
	@echo "  make build            Reconstruye la imagen de opencode"
	@echo "  make restart-opencode Recrea el contenedor opencode"
	@echo "  make health           Comprueba /global/health"

up:
	$(DC) up -d opencode

up-full:
	$(DC) --profile full up -d

down:
	$(DC) --profile full down

ps:
	$(DC) ps

logs:
	$(DC) logs -f opencode

build:
	$(DC) build opencode

restart-opencode:
	$(DC) up -d --force-recreate opencode

health:
	@set -a; . ./.env; [ -f ./.env.local ] && . ./.env.local; set +a; \
	curl -fsS -u "$$OPENCODE_SERVER_USERNAME:$$OPENCODE_SERVER_PASSWORD" \
	  http://127.0.0.1:$${OPENCODE_PORT:-4096}/global/health && echo ""
