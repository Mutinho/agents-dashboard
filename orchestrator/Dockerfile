# Orquestador multi-agente (Node/TS). Compila a dist/ y arranca el server.
FROM node:22-slim

# git: para clonar repos de GitHub en los workspaces.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/*

# CA corporativa OPCIONAL (proxy Zscaler) para que 'git clone https://github.com'
# funcione tras el proxy. Si certs/ está vacío, no instala nada y sigue.
COPY certs/ /tmp/corp-certs/
RUN if ls /tmp/corp-certs/*.crt >/dev/null 2>&1; then \
        cp /tmp/corp-certs/*.crt /usr/local/share/ca-certificates/ && update-ca-certificates; \
    fi && rm -rf /tmp/corp-certs
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt
ENV GIT_SSL_CAINFO=/etc/ssl/certs/ca-certificates.crt

WORKDIR /app

# Instalar dependencias (cache de capa)
COPY package.json ./
RUN npm install --omit=dev=false --no-audit --no-fund

# Código + build
COPY tsconfig.json ./
COPY src ./src
COPY migrations ./migrations
RUN npm run build

EXPOSE 8787 8788

CMD ["node", "dist/index.js"]
