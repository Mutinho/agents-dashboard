# --- Etapa 1: build de Angular ---
FROM node:22-slim AS build

# CA corporativa OPCIONAL (proxy Zscaler) para que npm install funcione tras el proxy.
# Igual que en opencode: si certs/ está vacío, no instala nada y el build sigue.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY certs/ /tmp/corp-certs/
RUN if ls /tmp/corp-certs/*.crt >/dev/null 2>&1; then \
        cp /tmp/corp-certs/*.crt /usr/local/share/ca-certificates/ && update-ca-certificates; \
    fi && rm -rf /tmp/corp-certs
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npx ng build

# --- Etapa 2: servir con nginx ---
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/dashboard/browser /usr/share/nginx/html
EXPOSE 80
