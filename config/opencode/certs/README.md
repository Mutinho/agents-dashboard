# Certificados CA corporativos (opcional)

Esta carpeta es para **CA(s) raíz corporativas** cuando trabajas detrás de un
proxy que intercepta TLS (MITM), típicamente **Zscaler**. El contenedor
`opencode` necesita confiar en esa CA para poder llamar por HTTPS a
`https://openrouter.ai`; de lo contrario falla con:

```
unable to get local issuer certificate  (UNABLE_TO_GET_ISSUER_CERT_LOCALLY)
```

## ¿Necesito hacer algo?

- **PC personal / sin proxy corporativo** → **NO**. Deja esta carpeta como está
  (solo con `.gitkeep`). El build funciona con las CAs públicas.
- **PC corporativo con Zscaler (u otro MITM)** → **SÍ**. Copia aquí la CA raíz
  corporativa en formato PEM con extensión `.crt`. El Dockerfile la instalará
  automáticamente.

## Cómo obtener la CA (ejemplo Zscaler en WSL/Ubuntu)

La CA suele estar ya en el store del sistema del host:

```bash
# Busca el certificado corporativo en el host
find /usr/local/share/ca-certificates /etc/ssl/certs -iname '*zscaler*'

# Cópialo a esta carpeta (ejemplo)
cp /usr/local/share/ca-certificates/zscaler-corporate-root.crt \
   config/opencode/certs/
```

Alternativa (extraer la raíz desde la cadena que presenta el proxy):

```bash
echo | openssl s_client -connect openrouter.ai:443 -servername openrouter.ai \
  -showcerts 2>/dev/null > /tmp/chain.pem
# Extrae el último certificado de la cadena (la CA raíz) y guárdalo como .crt
```

Después reconstruye la imagen:

```bash
docker compose build opencode && docker compose up -d --force-recreate opencode
```

## Notas

- Los ficheros `*.crt` de esta carpeta **NO se versionan** (están en
  `.gitignore`): dependen de tu red y no deben acoplar el repositorio a un
  entorno concreto.
- Puedes dejar **varias** CAs `.crt` aquí; todas se instalarán.
- Verificación rápida de que el contenedor ya confía:
  ```bash
  docker exec ad-opencode curl -sS -o /dev/null -w "%{http_code}\n" \
    https://openrouter.ai/api/v1/models   # debe devolver 200
  ```
