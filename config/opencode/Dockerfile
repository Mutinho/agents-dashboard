# OpenCode server dockerizado
# Motor de agentes conectado a OpenRouter (DeepSeek).
FROM node:22-slim

# Dependencias mínimas: git (OpenCode lo usa para VCS), ca-certificates, curl (healthcheck)
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

# Instala OpenCode globalmente
# (se fija versión en build-arg para reproducibilidad; por defecto latest)
ARG OPENCODE_VERSION=latest
RUN npm install -g opencode-ai@${OPENCODE_VERSION}

# CA(s) corporativas OPCIONALES (p.ej. proxy Zscaler que intercepta TLS).
# Copia TODO el directorio certs/ e instala cualquier .crt que contenga.
# En un equipo SIN proxy corporativo, certs/ solo tiene .gitkeep -> no instala
# nada y el build funciona igual. En un equipo CON Zscaler, deja aquí la CA raíz
# (ver config/opencode/certs/README.md) y se instalará automáticamente.
COPY certs/ /tmp/corp-certs/
RUN if ls /tmp/corp-certs/*.crt >/dev/null 2>&1; then \
        echo "Instalando CA(s) corporativas:" && ls /tmp/corp-certs/*.crt && \
        cp /tmp/corp-certs/*.crt /usr/local/share/ca-certificates/ && \
        update-ca-certificates; \
    else \
        echo "Sin CA corporativa (certs/ vacío): se usan solo CAs públicas"; \
    fi \
    && rm -rf /tmp/corp-certs

# Config global de OpenCode
ENV XDG_CONFIG_HOME=/root/.config
# Node debe confiar en la cadena TLS del sistema (CA bundle de Debian) para
# llamar a https://openrouter.ai. Sin esto: "unable to get local issuer certificate".
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt
# Directorio de trabajo (se montarán los workspaces aquí)
WORKDIR /workspaces

EXPOSE 4096

# Arranca el server headless, escuchando en todas las interfaces DENTRO del contenedor.
# La publicación de puertos en compose lo limita a 127.0.0.1 del host.
CMD ["opencode", "serve", "--hostname", "0.0.0.0", "--port", "4096"]
