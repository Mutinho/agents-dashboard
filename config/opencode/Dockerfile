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

# CA corporativa (proxy Zscaler MITM): el contenedor debe confiar en ella para
# poder hacer TLS a https://openrouter.ai. Sin esto, Node/curl fallan con
# "unable to get local issuer certificate".
COPY certs/zscaler-corporate-root.crt /usr/local/share/ca-certificates/zscaler-corporate-root.crt
RUN update-ca-certificates

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
