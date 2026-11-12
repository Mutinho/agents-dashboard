# Orquestador multi-agente (Node/TS). Compila a dist/ y arranca el server.
FROM node:22-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

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
