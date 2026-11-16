# kiro-runner: servicio que ejecuta turnos con Kiro CLI en modo no interactivo.
# Los binarios de kiro-cli NO van en la imagen: se montan desde el host (solo lectura)
# en /opt/kiro/bin para que la versión coincida con la instalada y no versionar ~260 MB.
FROM node:22-slim

# git: los agentes Dev/Validador usan git local. python3: skills con scripts (ui-ux-pro-max).
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates curl python3 \
    && rm -rf /var/lib/apt/lists/*

# CA corporativa OPCIONAL (proxy Zscaler). Si certs/ está vacío, no instala nada.
COPY certs/ /tmp/corp-certs/
RUN if ls /tmp/corp-certs/*.crt >/dev/null 2>&1; then \
        cp /tmp/corp-certs/*.crt /usr/local/share/ca-certificates/ && update-ca-certificates; \
    fi && rm -rf /tmp/corp-certs
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt \
    SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt \
    GIT_SSL_CAINFO=/etc/ssl/certs/ca-certificates.crt \
    PATH=/opt/kiro/bin:$PATH

WORKDIR /app
COPY server.mjs ./

# git no debe quejarse de propietarios distintos en /projects
RUN git config --global --add safe.directory '*'

EXPOSE 4097
CMD ["node", "server.mjs"]
