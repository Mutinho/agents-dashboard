# Plan: Sistema de Agentes Autónomos con OpenCode + Gemini (WSL Ubuntu, Docker, Dashboard Angular)

> Documento de diseño. No es código de producción, es el plan ejecutable por fases.
> Versión: 1.0 — 2026-11-12

---

## 0. Aviso de seguridad (leer primero)

- Se pegó una API key de Gemini en un chat. **Trátala como comprometida y revócala** en Google AI Studio aunque ya no la uses.
- El proveedor LLM de este sistema es **OpenRouter** (una sola key `OPENROUTER_API_KEY` da acceso a muchos modelos: Gemini Flash/Pro, Claude, GPT, etc.).
- La key de OpenRouter vive **solo** en un fichero `.env` (fuera de git, en `.gitignore`) y se inyecta por variable de entorno a los contenedores. Nunca se escribe en `opencode.jsonc`, ni en imágenes Docker, ni en el repo del dashboard.
- Todo el sistema es **local** (bind a `127.0.0.1`). Nada se expone a la red externa en esta primera versión.

---

## 1. Objetivo y alcance

### 1.1 Qué queremos conseguir
Un entorno personal, reproducible y dockerizado en WSL Ubuntu que permita:

1. Usar **OpenCode** como motor de agentes de IA, conectado a **OpenRouter** (una key, pago por tokens, acceso a múltiples modelos: Gemini Flash/Pro, Claude, GPT, etc.).
2. Crear y ejecutar **agentes autónomos que conversan entre ellos** con roles: **Product Owner (PO)**, **Developer (Dev)**, **UX** y **Validador (QA)**.
3. Poder lanzar **varias instancias del mismo rol en paralelo** (p.ej. 2 Devs a la vez).
4. **Persistir las sesiones** agrupadas en **espacios / proyectos de trabajo**.
5. Un **dashboard artesanal en Angular** (local) para: ver y gestionar agentes (skills, hooks, descripción), ver proyectos/espacios, y seguir las conversaciones multi-agente en vivo.

### 1.2 Fuera de alcance (v1)
- Acceso remoto / multiusuario / autenticación avanzada.
- Despliegue en cloud.
- Conexión directa a proveedores (Google AI Studio, Vertex, Anthropic...): todo pasa por **OpenRouter** como gateway único.

### 1.3 Principios de diseño
- **Artesanal y extensible**: cada pieza pequeña, bien separada, para poder añadir funcionalidades y skills de diseño después.
- **OpenCode como motor, orquestación propia encima**: no reinventamos el agente; coordinamos varios.
- **Todo reproducible**: `docker compose up` levanta el sistema completo.
- **Fuente de verdad clara**: OpenCode gestiona sesiones/mensajes; nuestra capa añade proyectos, roles, conversaciones multi-agente y estado del dashboard.

---

## 2. Cómo funciona OpenCode (lo que condiciona el diseño)

Resumen verificado de la documentación oficial de OpenCode, que fundamenta las decisiones:

- **`opencode serve`** arranca un servidor HTTP headless (OpenAPI 3.1).
  - Flags: `--port` (default `4096`), `--hostname` (default `127.0.0.1`), `--cors <origin>` (repetible).
  - Auth opcional por basic-auth con `OPENCODE_SERVER_PASSWORD` (+ `OPENCODE_SERVER_USERNAME`).
  - Spec navegable en `http://<host>:<port>/doc`.
- **APIs relevantes del server**:
  - `GET /global/health` → salud y versión.
  - `GET /global/event` → **stream de eventos SSE** (clave para el dashboard en vivo).
  - `GET /project`, `GET /project/current` → proyectos.
  - `GET/PATCH /config`, `GET /config/providers` → configuración y proveedores/modelos.
  - Sesiones, mensajes, agentes, comandos, ficheros, TUI (`/tui` para dirigir la TUI).
- **SDKs oficiales**: TypeScript (`@opencode-ai/sdk`) y Python (`opencode-sdk-python`). Usaremos el **SDK de TypeScript** en el orquestador (mismo ecosistema que el dashboard Angular).
- **Agentes** = fichero Markdown con frontmatter o entrada JSONC:
  - Campos: `description`, `mode` (`primary` | `subagent` | `all`), `model`, `permissions`, y el cuerpo Markdown es el **system prompt**.
  - Ubicaciones: `~/.config/opencode/agents/<name>.md` (global) o `.opencode/agents/<name>.md` (proyecto).
  - Built-ins: `build`, `plan`, `general`, `explore`.
  - `permissions` por acción/recurso/efecto (`allow`/`ask`/`deny`), incluida la acción `subagent` (qué subagentes puede lanzar un agente).
- **Skills** y **plugins/hooks**: OpenCode soporta Agent Skills (capacidades reutilizables) y un sistema de plugins/hooks para enganchar lógica en eventos.
- **Proveedor OpenRouter**: OpenRouter está en el catálogo de OpenCode (gateway OpenAI-compatible, 75+ proveedores). Se configura con `OPENROUTER_API_KEY`, `baseURL: https://openrouter.ai/api/v1`, y los modelos se referencian como `openrouter/<vendor>/<model>`. En esta instalación hay **un único modelo habilitado**: `openrouter/deepseek/deepseek-v4.1-flash-1017`. Autenticación vía `opencode auth login -p openrouter` o por env var en el contenedor.

> Implicación de diseño: OpenCode ya nos da **server + eventos SSE + SDK + agentes + sesiones persistidas**. Nuestro trabajo es (a) **dockerizarlo**, (b) construir un **orquestador multi-agente** por encima usando el SDK y los eventos, y (c) un **dashboard Angular** que consume la API del orquestador.

---

## 3. Arquitectura global

### 3.1 Vista de componentes

```
┌──────────────────────────────────────────────────────────────────────┐
│                        WSL Ubuntu (host)                               │
│                                                                        │
│  ┌──────────────────────────  docker compose  ─────────────────────┐  │
│  │                                                                   │  │
│  │  ┌───────────────┐   ┌────────────────────────┐  ┌────────────┐  │  │
│  │  │  opencode     │   │   orchestrator (Node/TS)│  │ dashboard  │  │  │
│  │  │  serve        │◄──┤   - SDK OpenCode        │  │ (Angular)  │  │  │
│  │  │  :4096        │   │   - bus de mensajes     │◄─┤  nginx     │  │  │
│  │  │  (motor LLM)  │──►│   - API REST + WS       │  │  :4200     │  │  │
│  │  └──────┬────────┘   │   - persistencia        │  └────────────┘  │  │
│  │         │            │   :8787 (REST) :8788(WS)│                   │  │
│  │         │            └───────────┬─────────────┘                   │  │
│  │         │                        │                                 │  │
│  │   ┌─────▼──────┐          ┌───────▼────────┐   ┌─────────────┐    │  │
│  │   │ OpenRouter │          │   Postgres     │   │ NATS broker │    │  │
│  │   │ (externo)  │          │  (dominio/     │   │  :4222      │    │  │
│  │   └────────────┘          │  persistencia) │   │  (pub/sub)  │    │  │
│  │                           └────────────────┘   └─────────────┘    │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                        │
│  Volúmenes persistentes: ./data/opencode, ./data/db, ./workspaces/*    │
└──────────────────────────────────────────────────────────────────────┘
         ▲
         │ navegador en Windows → http://localhost:4200
```

### 3.2 Contenedores (servicios compose)

| Servicio        | Imagen base                | Puerto (local) | Rol |
|-----------------|----------------------------|----------------|-----|
| `opencode`      | `node:22` + opencode CLI   | `4096`         | Motor de agentes; `opencode serve` |
| `orchestrator`  | `node:22` (TS)             | `8787` REST / `8788` WS | Coordina multi-agente, expone API al dashboard |
| `broker`        | `nats:latest`              | `4222`         | Bus de mensajes entre agentes (pub/sub por topics) |
| `db`            | `postgres:16`              | `5432`         | Persistencia: proyectos, agentes, conversaciones, mensajes |
| `dashboard`     | `nginx` (sirve Angular build) | `4200`      | UI artesanal |

> **Decisión tomada: Postgres** (DB) y **NATS** (broker). Postgres por ser concurrente por diseño (instancias paralelas escribiendo a la vez) con `jsonb` nativo. NATS por ser un broker pub/sub ligero que encaja con el modelo de topics `conv.<id>.inbox.<agente>`; la persistencia del historial la lleva Postgres, así que NATS se usa como transporte (sin JetStream en v1).

### 3.3 Flujo de una tarea multi-agente (resumen)

1. En el dashboard creas un **Proyecto/Espacio** y escribes un objetivo (p.ej. "Construye una landing con formulario de contacto").
2. El orquestador crea una **conversación multi-agente** y da el turno inicial al **PO**.
3. El **PO** descompone el objetivo en requisitos/historias y publica un mensaje en el bus dirigido al **Dev** y al **UX**.
4. **Dev(s)** y **UX** trabajan (posiblemente en paralelo, varias instancias de Dev), publicando resultados/preguntas.
5. El **Validador** revisa entregables y emite veredicto (aprobado / cambios).
6. El orquestador aplica reglas de turno/parada (máx. iteraciones, condición de "done") y guarda todo.
7. El dashboard muestra la conversación en vivo vía WebSocket/SSE.

---

## 4. Diseño del orquestador multi-agente

Esta es la pieza más importante y la más "artesanal". OpenCode ejecuta **un agente por sesión**; para que **varios agentes conversen** necesitamos una capa de coordinación.

### 4.1 Conceptos del dominio

- **Workspace / Proyecto**: contenedor lógico de trabajo. Tiene un directorio físico (`./workspaces/<slug>`), una descripción y una colección de conversaciones.
- **AgentProfile**: definición de un rol (PO, Dev, UX, Validador). Incluye: nombre, rol, descripción, system prompt, modelo por defecto (flash/pro), skills, hooks, permisos.
- **AgentInstance**: una ejecución viva de un AgentProfile dentro de una conversación. Varias instancias del mismo profile pueden coexistir (`dev#1`, `dev#2`).
- **Conversation (multi-agente)**: hilo con un objetivo, una lista de participantes (instancias) y un historial de turnos.
- **Turn / Message**: cada intervención de un agente (quién, a quién, contenido, artefactos, tokens, coste estimado).
- **OpenCode Session**: sesión real en OpenCode que respalda a cada AgentInstance (para que OpenCode persista el contexto de ese agente).

### 4.2 Mapeo con OpenCode

- Cada **AgentInstance** → una **sesión de OpenCode** creada vía SDK, usando el agente correspondiente (`po`, `dev`, `ux`, `validator`).
- El orquestador **no** deja que los agentes se llamen entre sí libremente dentro de OpenCode. En su lugar, el orquestador **lee la salida** de una sesión y **enruta** el mensaje a la(s) sesión(es) destino como nuevo prompt. Así controla el flujo y evita bucles descontrolados.
- Los **eventos SSE** de `GET /global/event` alimentan al orquestador para saber cuándo un agente terminó su turno (streaming de tokens, fin de mensaje, llamada a tool).

### 4.3 Bus de mensajes y protocolo

Mensaje canónico entre agentes (publicado en el broker y persistido):

```json
{
  "id": "msg_01H...",
  "conversationId": "conv_01H...",
  "from": "po#1",
  "to": ["dev#1", "ux#1"],
  "type": "task | question | result | review | decision | system",
  "content": "Markdown con la intervención",
  "artifacts": [{ "path": "src/index.html", "action": "created" }],
  "meta": { "model": "openrouter/deepseek/deepseek-v4.1-flash-1017", "tokensIn": 1200, "tokensOut": 800 },
  "ts": "2026-11-12T10:30:00Z"
}
```

Topics del broker (NATS): `conv.<id>.inbox.<agentInstance>` y `conv.<id>.events`.

### 4.4 Políticas de orquestación (estrategias de turno)

Diseñadas como **estrategias intercambiables** (para experimentar). **v1 implementa solo la (1) Pipeline fijo**; las demás quedan para Fase 8.

1. **Pipeline fijo** ✅ (estrategia v1): orden fijo de etapas `PO → UX → Dev → Validador`, con loop de corrección. Cada agente, al recibir su turno, **decide si actúa o se auto-descarta** (ver protocolo de señales abajo), de modo que el orden es fijo pero no se fuerza trabajo inútil.
2. **Round-robin dirigido por PO** (evolución futura, Opción B): el PO marca el orden en cada turno vía el campo `to`; el orquestador lo respeta. El mecanismo de auto-descarte de la v1 es el embrión de este enrutado dinámico.
3. **Blackboard** (futuro): todos leen un estado común; el orquestador decide quién habla según reglas.

#### Protocolo de señales de control (v1 — pipeline fijo)

Cada agente termina su turno con una **señal** que el orquestador interpreta para enrutar:

| Señal | Emisor típico | Efecto en el orquestador |
|-------|---------------|--------------------------|
| `[SKIP] <motivo>` | cualquier etapa (p.ej. UX cuando no hay interfaz) | No produce entregable; pasa **inmediatamente** a la siguiente etapa |
| `[DONE] <resumen>` | PO/UX/Dev | Etapa completada; avanza a la siguiente |
| `[CHANGES] <lista>` | Validador | Vuelve a la etapa Dev (loop de corrección) con el feedback como contexto |
| `[APPROVED]` | Validador | **Condición de parada**: la conversación finaliza con éxito |
| `[BLOCKED] <motivo>` | cualquiera | Pausa la conversación y requiere intervención humana desde el dashboard |

Flujo de ejemplo con skip:
```
PO [DONE] → UX [SKIP "no hay UI que diseñar"] → Dev [DONE] → Validador [APPROVED]
```

Parámetros de control (por conversación):
- `maxIterations` (tope de turnos global; evita loops infinitos de `[CHANGES]`).
- `maxParallel` por rol (p.ej. 2 Devs).
- `stopCondition` (señal del Validador: `[APPROVED]`).
- `budgetTokens` / `budgetEUR` (freno por coste).

### 4.5 Ejecución paralela

- El orquestador mantiene un **pool de instancias** por conversación.
- Para 2 Devs en paralelo: crea `dev#1` y `dev#2` (dos sesiones OpenCode), reparte subtareas, y recoge resultados de forma concurrente (promesas).
- Concurrencia limitada por `maxParallel` y por el rate limit de OpenRouter.

### 4.6 Persistencia

Fuente de verdad doble pero separada:
- **OpenCode** persiste el contexto nativo de cada sesión (su propio almacenamiento, montado en volumen `./data/opencode`).
- **Nuestra DB** persiste el **modelo de dominio** (proyectos, profiles, instancias, conversaciones, mensajes, métricas). Esto es lo que consume el dashboard.

Esquema de DB (inicial):

```
workspaces(id, slug, name, description, path, created_at)
agent_profiles(id, key, role, name, description, system_prompt, default_model,
               skills_json, hooks_json, permissions_json, created_at, updated_at)
conversations(id, workspace_id, title, goal, strategy, status, max_iterations,
              created_at, finished_at)
conversation_participants(id, conversation_id, profile_key, instance_label,
                          opencode_session_id)
messages(id, conversation_id, from_instance, to_instances_json, type, content,
         artifacts_json, tokens_in, tokens_out, cost_estimate, ts)
runs(id, conversation_id, iteration, status, started_at, ended_at)
```

### 4.7 API del orquestador (consumida por el dashboard)

REST (`:8787`):
- `GET /api/health`
- `GET /api/providers` (proxy a OpenCode `GET /config/providers`)
- `GET /api/agents` / `GET /api/agents/:key` / `POST /api/agents` / `PUT /api/agents/:key`
- `GET /api/workspaces` / `POST /api/workspaces` / `GET /api/workspaces/:id`
- `POST /api/workspaces/:id/conversations` (crea objetivo + participantes + estrategia)
- `GET /api/conversations/:id` / `GET /api/conversations/:id/messages`
- `POST /api/conversations/:id/start` / `POST /api/conversations/:id/stop`
- `POST /api/conversations/:id/message` (inyectar mensaje humano)

WebSocket (`:8788`) o SSE:
- Canal por conversación con eventos: `message.created`, `turn.started`, `turn.tokens` (streaming), `turn.ended`, `conversation.status`, `cost.update`.

---

## 5. Diseño de los agentes (PO, Dev, UX, Validador)

Cada agente es un fichero Markdown en `./config/opencode/agents/` (montado en el contenedor OpenCode) + metadatos en la DB (para skills/hooks/descripción que muestra el dashboard).

### 5.1 Tabla de roles

| Rol | key | Modelo (OpenRouter) | Permisos clave | Propósito |
|-----|-----|---------------------|----------------|-----------|
| Product Owner | `po` | `openrouter/deepseek/deepseek-v4.1-flash-1017` | sin edición de ficheros; shell `deny` | Traducir objetivo → requisitos/historias, priorizar, decidir "done" |
| Developer | `dev` | `openrouter/deepseek/deepseek-v4.1-flash-1017` | edición + shell `ask` | Implementar, escribir y ejecutar tests |
| UX | `ux` | `openrouter/deepseek/deepseek-v4.1-flash-1017` | edición limitada (assets/HTML/CSS) | Diseño de interfaz, wireframes textuales, tokens de diseño |
| Validador/QA | `validator` | `openrouter/deepseek/deepseek-v4.1-flash-1017` | solo lectura + shell `ask` (tests) | Revisar entregables, ejecutar validaciones, emitir veredicto |

> **Modelo único por ahora**: en OpenRouter solo está habilitado `deepseek-v4.1-flash-1017`, así que **todos los roles usan el mismo modelo**. La diferencia entre agentes está en el **system prompt, permisos y comportamiento**, no en el modelo. El campo `model` por `AgentProfile` es editable desde el dashboard, de modo que cuando habilites más modelos en OpenRouter podrás asignar uno distinto por rol sin tocar código ni arquitectura. El ID exacto (`openrouter/deepseek/deepseek-v4.1-flash-1017`) se confirma en Fase 1 con `GET /config/providers`.

### 5.2 Ejemplo de definición (PO)

`./config/opencode/agents/po.md` (frontmatter real verificado en OpenCode 1.19.5)
```markdown
---
description: Product Owner. Convierte objetivos en requisitos claros y decide cuándo está terminado.
mode: subagent
model: openrouter/deepseek/deepseek-v4.1-flash-1017
temperature: 0.3
permission:
  edit: deny
  bash: deny
  webfetch: allow
---
Eres el Product Owner del equipo. Tu trabajo:
1. Clarificar el objetivo y descomponerlo en historias con criterios de aceptación.
2. Dirigir quién debe actuar a continuación (UX, Dev, Validador).
3. Al recibir resultados, decidir si se cumplen los criterios.
Termina SIEMPRE tu turno con una señal de control en una línea propia:
- `[DONE] <resumen>` cuando completas tu parte.
- `[SKIP] <motivo>` si en esta tarea no tienes nada que aportar.
- `[BLOCKED] <motivo>` si necesitas intervención humana.
Responde en español, en Markdown, conciso y accionable.
```

> El formato de `permission` es un mapa `accion: allow|ask|deny` (acciones: `edit`, `bash`, `webfetch`, ...), igual que en `opencode.jsonc`. Los cuatro agentes se cargan y se listan en `GET /agent`.

(Análogo para `dev.md`, `ux.md`, `validator.md`, cambiando prompt/permissions/model.
El **Validador** además usa `[APPROVED]` (parada con éxito) o `[CHANGES] <lista>` (volver a Dev).
El **UX** usará típicamente `[SKIP]` cuando no haya interfaz que diseñar.)

### 5.3 Skills

**Modelo real de OpenCode v2 (verificado):** las skills se descubren desde `~/.config/opencode/skills/<id>/SKILL.md` y se ofrecen al modelo mediante **una única tool `skill`**. El modelo elige qué skill cargar según su `description`. **No existe un allowlist de skills por agente** en el frontmatter (el campo `tools: {skills_*}` no aplica). El control nativo es: deshabilitar una skill globalmente (`metadata.opencode/autoinvoke: false` o `disable-model-invocation: true`) o vía `permission` sobre la tool `skill`.

**Consecuencia de diseño:** la asignación "skill → rol" se consigue por dos vías:
1. **System prompt del agente**: cada agente indica explícitamente qué skill(s) debe usar (efectivo; el modelo lo respeta).
2. **Metadato en nuestra DB/dashboard**: `skills_json` por `AgentProfile` es la fuente de verdad para **mostrar** las skills de cada agente en el dashboard (tu requisito), independientemente de que OpenCode las exponga todas.

**Skills instaladas** en `config/opencode/skills/` (montadas en el contenedor, verificadas en `GET /skill`), todas de fuente oficial salvo la local:

| Skill | Fuente | Rol asignado (vía prompt) |
|-------|--------|---------------------------|
| `doc-coauthoring` | Anthropic (oficial) | PO |
| `ui-ux-pro-max` | local (Kiro) — completa, con motor Python (soporta stack Angular) | UX |
| `frontend-design` | Anthropic (oficial) | UX |
| `webapp-testing` | Anthropic (oficial) | Dev, Validador |
| `web-design-guidelines` | Vercel (oficial) | Validador |

> `ui-ux-pro-max` trae scripts Python (motor BM25 sobre datos locales). Se auditó (sin red/exec/subprocess peligrosos) y la imagen `opencode` incluye `python3`. Verificado funcionando dentro del contenedor (búsqueda stack `angular`) y en una sesión real del agente UX (invocó `tool:skill` y generó un sistema de diseño).

### 5.4 Hooks

- OpenCode permite **plugins/hooks** que reaccionan a eventos (inicio/fin de sesión, antes de ejecutar una tool, etc.).
- Hooks útiles para el sistema:
  - `pre-tool`: registrar/filtrar comandos shell peligrosos.
  - `post-message`: calcular tokens/coste y publicar al orquestador.
  - `on-session-end`: notificar al orquestador que el turno acabó.
- En la DB: `hooks_json` por profile para visualizarlos en el dashboard.

---

## 6. Dashboard Angular (artesanal)

### 6.1 Stack
- Angular 20+ **standalone components + signals** (coherente con tus skills de Angular).
- `httpResource`/`resource` para datos, WebSocket service para tiempo real.
- Estado: signals + un par de stores sencillos (sin NgRx al principio; artesanal y ampliable).
- Estilos: base propia + posibilidad de aplicar skills de diseño (ui-ux-pro-max, frontend-design) para iterar la estética.
- Build servido por `nginx` en el contenedor `dashboard`.

### 6.2 Pantallas (v1)

1. **Dashboard / Home**: salud del sistema (OpenCode, orquestador, broker, db), coste acumulado, conversaciones activas.
2. **Agentes**: lista de AgentProfiles con rol, descripción, modelo, **skills** y **hooks**; detalle editable; crear nuevo agente.
3. **Workspaces / Proyectos**: lista de espacios; crear; dentro de cada uno, lista de conversaciones.
4. **Conversación (multi-agente)**: vista tipo "sala" con el hilo de mensajes por agente (avatares/colores por rol), streaming en vivo, panel lateral de participantes (instancias), artefactos generados, controles (start/stop/inyectar mensaje), métricas de tokens/coste.
5. **Ajustes**: proveedores/modelos (desde OpenCode), presupuesto, estrategia por defecto.

### 6.3 Modelo de datos en el front (TS)
Reflejo del dominio del orquestador: `Workspace`, `AgentProfile`, `AgentInstance`, `Conversation`, `AgentMessage`, `RunMetrics`. Servicios: `AgentsService`, `WorkspacesService`, `ConversationsService`, `RealtimeService` (WS), `ProvidersService`.

### 6.4 Tiempo real
- `RealtimeService` abre WS al orquestador y multiplexa por `conversationId`.
- Los componentes de conversación se suscriben a signals derivadas del stream.

---

## 7. Estructura de directorios del proyecto

```
~/own_ia/
├── PLAN.md                      # este documento
├── .env                         # OPENROUTER_API_KEY, puertos, credenciales DB (NO en git)
├── .env.example                 # plantilla sin secretos
├── .gitignore
├── docker-compose.yml
├── config/
│   └── opencode/
│       ├── opencode.jsonc       # provider google + modelos + agents + permisos
│       └── agents/
│           ├── po.md
│           ├── dev.md
│           ├── ux.md
│           └── validator.md
├── orchestrator/                # Node/TS
│   ├── Dockerfile
│   ├── package.json
│   ├── src/
│   │   ├── index.ts
│   │   ├── opencode/            # cliente SDK, gestión de sesiones
│   │   ├── bus/                 # cliente NATS (interfaz MessageBus)
│   │   ├── domain/              # tipos del dominio
│   │   ├── strategies/          # round-robin, pipeline, blackboard
│   │   ├── persistence/         # repos DB
│   │   └── api/                 # REST + WS
│   └── migrations/
├── dashboard/                   # Angular
│   ├── Dockerfile
│   ├── nginx.conf
│   └── src/...
├── workspaces/                  # directorios de trabajo de cada proyecto (volumen)
└── data/
    ├── opencode/                # almacenamiento de OpenCode (volumen)
    └── db/                      # datos Postgres (volumen)
```

---

## 8. Configuración de OpenCode + OpenRouter (resumen de ficheros)

`config/opencode/opencode.jsonc` (esqueleto):
```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "openrouter": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "OpenRouter",
      "options": {
        "baseURL": "https://openrouter.ai/api/v1"
        // la API key llega por env OPENROUTER_API_KEY; no se escribe aquí
      },
      "models": {
        "deepseek/deepseek-v4.1-flash-1017": { "name": "DeepSeek v4.1 Flash" }
      }
    }
  },
  "model": "openrouter/deepseek/deepseek-v4.1-flash-1017",
  "agents": {
    "po":        { "mode": "subagent" },
    "dev":       { "mode": "subagent" },
    "ux":        { "mode": "subagent" },
    "validator": { "mode": "subagent" }
  },
  "permissions": [
    { "action": "shell", "resource": "*", "effect": "ask" }
  ]
}
```

> Alternativa: autenticar una vez con `opencode auth login -p openrouter` (guarda la credencial en el auth store de OpenCode, montado en volumen). En Docker es más reproducible pasar `OPENROUTER_API_KEY` por env.

`.env.example`:
```
# OpenRouter (gateway único de modelos)
OPENROUTER_API_KEY=sk-or-v1-...

# Puertos locales
OPENCODE_PORT=4096
ORCH_REST_PORT=8787
ORCH_WS_PORT=8788
DASHBOARD_PORT=4200

# DB
POSTGRES_USER=own_ia
POSTGRES_PASSWORD=cambia-esto
POSTGRES_DB=own_ia
```

`docker-compose.yml` (esqueleto de servicios): `opencode`, `orchestrator`, `broker` (nats), `db` (postgres), `dashboard` (nginx), todos con bind a `127.0.0.1` y los volúmenes indicados.

### 8.1 Cascada de entorno: `.env` → `.env.local`

Para ajustar el entorno de una máquina concreta sin tocar el `.env` base:

- **`.env`**: valores base (incluye la `OPENROUTER_API_KEY`). No se versiona.
- **`.env.local`** (opcional): overrides locales que **ganan** sobre `.env`. No se versiona.
- **`.env.example` / `.env.local.example`**: plantillas documentadas que **sí** se versionan.

La infra se levanta con el wrapper **`./dc.sh`** (o los targets de **`Makefile`**), que invoca `docker compose --env-file .env --env-file .env.local ...`. Esto garantiza que `.env.local` pise **tanto** la interpolación `${...}` del compose **como** el entorno de los contenedores (precedencia verificada). Si `.env.local` no existe, se usa solo `.env`.

Comandos habituales: `make up` (solo opencode), `make up-full` (todo), `make health`, `make logs`, `make build`.

### 8.2 Workspaces con directorio de trabajo real (carpetas locales + repos GitHub)

Además del modo "vacío" (los agentes crean de cero), un workspace puede apuntar a **código real del ordenador**:

- **Raíz permitida**: `PROJECTS_ROOT` (`.env`, por defecto `/home/javi/proyects_ia`) se monta en **ambos** contenedores (`opencode` y `orchestrator`) en la misma ruta `/projects`.
- **Fuente del workspace** (elegible al crearlo en el dashboard):
  - `empty`: carpeta nueva bajo la raíz.
  - `local`: una subcarpeta **existente** bajo la raíz (validada con anti path-traversal).
  - `github`: **uno o varios** repos públicos que el orquestador **clona** (`git clone --depth 1`) dentro de `/projects/<slug>/`.
- Los agentes trabajan en **lectura/escritura** sobre esa ruta; los ficheros creados aparecen en tu disco real.
- **git** en la imagen del orquestador + CA corporativa (`GIT_SSL_CAINFO`) para clonar a través del proxy Zscaler.

> **Permiso clave (`external_directory`)**: para que los agentes puedan leer/escribir en `/projects` sin colgarse, `opencode.jsonc` fija `permission.external_directory: "allow"` y `permission.question: "deny"`. Sin esto, OpenCode pone `external_directory` en `ask` y el agente **se cuelga esperando aprobación** en modo autónomo (causa raíz diagnosticada). Nota: el binario 1.19.5 usa el **esquema V1** de config → `permission` es un **objeto** (`{accion: allow|ask|deny}`), no el array `permissions` de V2.
>
> **Verificado E2E**: workspace con repo GitHub público → clonado en `/home/javi/proyects_ia/<slug>/`; una conversación leyó el repo real y escribió `ANALISIS.md` en disco; flujo PO→UX→Dev→Validador a `done`.

---

## 9. Control de costes (OpenRouter / tokens)

- **Modelo único por ahora**: todos los agentes usan `openrouter/deepseek/deepseek-v4.1-flash-1017`. Cuando habilites varios modelos en OpenRouter, se podrá asignar modelos más baratos a turnos ligeros (PO/UX) y más potentes a código/validación (Dev/Validador) — todo editable por `AgentProfile` sin cambios de código. **Ver [`docs/dev-model-limitation.md`](docs/dev-model-limitation.md)**: el rol Dev rinde peor con Flash en turnos largos; ahí se recomiendan modelos (MiniMax M3 (~$0.075/$0.30) / GPT-6 Luna ($0.10/$0.50) / GLM-5.3-Flash) con buen equilibrio coste/capacidad.
- OpenRouter expone coste por request en su respuesta/dashboard; el orquestador registra `tokensIn/Out` por mensaje y calcula coste estimado con una tabla de precios configurable (o leyendo el coste que devuelve OpenRouter).
- Frenos: `budgetTokens`/`budgetEUR` por conversación y tope global; al superarse, la conversación pasa a `paused`.
- Recomendado: fijar un **límite de crédito/gasto en el panel de OpenRouter** como red de seguridad adicional.
- El dashboard muestra coste acumulado por proyecto y por conversación.

---

## 10. Seguridad y límites

- Bind **solo a `127.0.0.1`** en todos los servicios.
- `OPENCODE_SERVER_PASSWORD` activado aunque sea local (defensa en profundidad).
- Permisos de agentes **restrictivos por defecto**: PO/UX/Validador sin shell libre; Dev con shell en modo `ask` o acotado a su workspace.
- Cada conversación trabaja en su **directorio aislado** (`./workspaces/<slug>`), nunca en el host fuera de ahí.
- `.env` y `data/` en `.gitignore`.
- Límite de iteraciones y presupuesto para evitar bucles infinitos y gasto descontrolado.

### 10.1 Portabilidad de red: proxy corporativo (Zscaler) vs equipo personal

Algunos equipos corporativos usan un **proxy que intercepta TLS (MITM)** —típicamente **Zscaler**—. En ese caso `https://openrouter.ai` lo firma una CA corporativa que el contenedor no conoce, y OpenCode falla con `unable to get local issuer certificate`.

Diseño adoptado para que el sistema sea **portable** entre un PC corporativo y uno personal sin cambios de código:

- La imagen `opencode` instala **cualquier `.crt`** que exista en `config/opencode/certs/` (CA raíz corporativa), vía `update-ca-certificates`, y Node la usa con `NODE_EXTRA_CA_CERTS`.
- **Paso OPCIONAL**: si el equipo **no** tiene proxy MITM (p.ej. PC personal), la carpeta `certs/` solo contiene `.gitkeep` y el build **no instala nada** (usa CAs públicas). Funciona igual.
- Los `*.crt` **no se versionan** (`.gitignore`): dependen de la red local, no del repo. Instrucciones en `config/opencode/certs/README.md`.
- Verificado en ambos escenarios: build con CA corporativa (instala) y build sin ella (usa CAs públicas); ambos correctos.

---

## 11. Plan por fases (checklist ejecutable)

### Fase 0 — Preparación del entorno (WSL)
- [ ] Verificar Docker + Docker Compose en WSL Ubuntu (`docker --version`, `docker compose version`).
- [ ] Crear una **cuenta/API key en OpenRouter** y añadir crédito; fijar un límite de gasto en su panel.
- [ ] Revocar la API key de Gemini que se expuso (ya no se usa).
- [ ] Crear estructura de carpetas de `~/own_ia/` y `.gitignore`.
- [ ] Crear `.env` a partir de `.env.example` con la `OPENROUTER_API_KEY`.
- [ ] (**Solo si el equipo tiene proxy MITM tipo Zscaler**) copiar la CA raíz corporativa a `config/opencode/certs/*.crt`. En PC personal sin proxy, omitir este paso.

### Fase 1 — OpenCode + OpenRouter dockerizado
- [ ] `Dockerfile`/servicio `opencode` con OpenCode CLI instalado.
- [ ] `config/opencode/opencode.jsonc` con provider `openrouter` (baseURL + modelo `deepseek-v4.1-flash-1017`).
- [ ] Levantar `opencode serve` en contenedor (puerto `4096`, host `0.0.0.0` dentro del contenedor, publicado solo a `127.0.0.1`).
- [ ] Verificar: `GET /global/health` responde; `GET /config/providers` lista OpenRouter.
- [ ] Prueba manual: una sesión simple que responda usando `openrouter/deepseek/deepseek-v4.1-flash-1017`.

### Fase 2 — Definición de agentes
- [x] Crear `po.md`, `dev.md`, `ux.md`, `validator.md` con prompts, modelos y permisos. **(hecho; verificado en `GET /agent`)**
- [x] Probar cada agente de forma aislada (sesión + prompt + respuesta). **(PO probado: responde en rol y emite `[DONE]`; auto-descartó UX correctamente)**
- [ ] Definir skills iniciales y hooks básicos; documentarlos. **(se implementa en Fase 3, cuando el orquestador los consuma y el dashboard los muestre)**

### Fase 3 — Orquestador (núcleo)
### Fase 3 — Orquestador (núcleo) ✅ COMPLETA (verificada E2E)
- [x] Scaffold Node/TS con SDK de OpenCode (`@opencode-ai/sdk@1.19.5`, Fastify, pg, ws).
- [x] Cliente OpenCode: crear sesión por AgentInstance, enviar prompt, leer respuesta.
- [x] Modelo de dominio + migraciones DB (Postgres, con `jsonb` para skills/hooks/artifacts).
- [x] Estrategia **pipeline fijo** (PO→UX→Dev→Validador con loop) como única estrategia de v1.
- [x] Parser de **señales de control** (`[DONE]`, `[SKIP]`, `[CHANGES]`, `[APPROVED]`, `[BLOCKED]`).
- [x] Bucle de orquestación con `maxIterations` y `stopCondition = [APPROVED]`; skip + loop de corrección.
- [x] Persistir conversaciones y mensajes.
- [x] API REST mínima (`workspaces`, `conversations`, `start/stop`, `messages`) + WS de eventos.

> **Verificado**: una conversación real terminó en `done` — PO `[DONE]`, UX `[SKIP]` (auto-descarte), Dev `[DONE]`, Validador `[APPROVED]`. Artefactos en el workspace aislado `/workspaces/<slug>`; el `csv_to_json.py` generado funciona. Coste total $0.0029.
>
> **Aprendizajes clave (aplicados):**
> - El fetch nativo de Node (undici) aborta turnos largos a los ~5 min (`HeadersTimeoutError`). El cliente amplía `headersTimeout`/`bodyTimeout` a 30 min (turnos de agentes que escriben ficheros y ejecutan tests son largos).
> - Aislamiento: el pipeline inyecta el `workspace.path` en el contexto para que los agentes trabajen solo en su directorio.
> - En modo autónomo el permiso `bash: ask` cuelga el turno (nadie aprueba). Dev/Validador usan `bash: allow` dentro del workspace aislado.
> - Healthcheck de opencode debe incluir basic-auth (`-u`), o marca `unhealthy` (401).
> - Reconstruir el orchestrator con `--no-cache` (Docker cacheaba `COPY src`).

### Fase 4 — Bus de mensajes y paralelismo ✅ COMPLETA (verificada E2E)
- [x] Integrar **NATS** (contenedor `broker`) y una interfaz `MessageBus` en el orquestador (`NatsBus` + `NoopBus` fallback).
- [x] Soporte de **múltiples instancias por rol** (`dev#1`, `dev#2`) con `maxParallel` (etapa Dev paralela con pool de concurrencia).
- [x] Topics por conversación (`conv.<id>.events`, `conv.<id>.messages`); `emit` combinado WS + NATS.
- [x] Control de concurrencia (`maxParallel`) y timeout por turno (robustez modo autónomo).

> **Verificado**: conversación con `parallelDev=2` terminó en `done`. Los eventos NATS mostraron `turn.started dev#1` y `turn.started dev#2` concurrentes; `dev#1` y `dev#2` persistidos como instancias y mensajes separados; `slugify.py` y `wordcount.py` generados y funcionales. Coste $0.0023.
>
> **Aprendizaje aplicado**: los turnos de Dev a veces no retornan (bucle de tool-calls del modelo). Se añadió un **timeout por turno** (`TURN_TIMEOUT_MS`, default 6 min) con `AbortController`: si expira, el turno devuelve error en vez de colgar la conversación. La etapa Dev paralela es **tolerante a fallos** (solo falla si TODAS las instancias fallan).

### Fase 5 — Tiempo real + métricas ✅ COMPLETA (verificada E2E)
- [x] Canal WebSocket + bus NATS con eventos (`message.created`, `turn.*`, `cost.update`, `budget.exceeded`, `conversation.status`).
- [x] Cálculo de tokens/coste por mensaje y **agregados** (endpoints `/api/conversations/:id/metrics` y `/api/workspaces/:id/metrics`).
- [x] **Frenos de presupuesto**: `budgetUsd` por conversación; al superarse → `paused` + eventos.

> **Unidad USD** (coherente con OpenRouter; no se hace conversión de moneda).
> **Verificado**: conversación con `budgetUsd=0.001` pasó a `paused` tras el primer turno (gastó $0.0023); eventos `cost.update` → `budget.exceeded` → `conversation.status(paused)` emitidos en orden. Caso sin límite (`budgetUsd=0`) completa normal con `budgetRemainingUsd=null`. Métricas agregadas (coste/tokens) correctas por conversación y por workspace.

### Fase 6 — Dashboard Angular (v1) ✅ COMPLETA (verificada E2E)
- [x] Scaffold Angular 22 standalone + signals; `nginx` + Dockerfile multi-stage.
- [x] Servicios HTTP (`ApiService`) + `RealtimeService` (WS con signals + reconexión).
- [x] Pantalla **Agentes** (lista + detalle con skills/hooks/permisos/modelo).
- [x] Pantalla **Workspaces** (lista + alta) + **detalle** (crear conversación con goal/budget/parallelDev).
- [x] Pantalla **Conversación** (hilo multi-agente en vivo por rol/color, señales, métricas, start/stop; `effect` sobre `lastEvent`).
- [x] Pantalla **Home** (salud + coste + conversaciones activas) y **Ajustes** (salud + modelos por rol).

> **Diseño**: tema Dark/OLED data-dense derivado de la skill `ui-ux-pro-max` (paleta verde operacional + rojo incidente, tipografía Fira), convenciones Angular 22 (standalone, signals, `@if/@for`, lazy routes).
> **Verificado**: `docker compose --profile full up` levanta los 5 servicios; dashboard en `http://localhost:4200` sirve la app; proxy nginx `/api` (REST) y `/ws` (WebSocket → HTTP 101). E2E desde la UI: crear workspace → conversación con presupuesto → iniciar → pipeline a `done` (4 mensajes, $0.0028).
> **Nota build**: `optimization.fonts.inline=false` (el proxy corporativo bloquea la descarga de Google Fonts en build; se cargan en runtime). CA Zscaler opcional también en el build del dashboard.

### Fase 7 — Integración y pruebas end-to-end
- [ ] `docker compose up` levanta todo y el dashboard abre en `http://localhost:4200`.
- [ ] Caso E2E: crear proyecto → objetivo → PO descompone → UX+Dev trabajan → Validador aprueba → artefactos en `workspaces/<slug>`.
- [ ] Probar 2 Devs en paralelo.
- [ ] Verificar persistencia (reiniciar contenedores y recuperar conversaciones).

### Fase 8 — Pulido y extensibilidad
- [ ] Añadir **round-robin dirigido por PO (Opción B)** reutilizando el mecanismo de auto-descarte; luego blackboard. Seleccionable por conversación desde el dashboard.
- [ ] Aplicar skills de diseño para mejorar la estética del dashboard.
- [ ] Documentar cómo añadir un nuevo rol de agente y una nueva skill.
- [ ] (Opcional) autenticación básica del dashboard y backups de la DB.

---

## 12. Decisiones (resueltas)

1. **DB**: ✅ **RESUELTO → Postgres** (desde el inicio; sin fase SQLite intermedia).
2. **Broker**: ✅ **RESUELTO → NATS** (directo desde el inicio, sin fase in-memory; pub/sub como transporte, persistencia en Postgres).
3. **Modelos por rol**: ✅ **RESUELTO → modelo único** `openrouter/deepseek/deepseek-v4.1-flash-1017` para todos los roles (es el único habilitado en OpenRouter por ahora). Diferenciación por prompt/permisos, no por modelo. `model` editable por agente en el dashboard para el futuro. ID exacto a confirmar en Fase 1 con `GET /config/providers`.
4. **Estrategia inicial**: ✅ **RESUELTO → Pipeline fijo (Opción A)** con protocolo de señales de control y auto-descarte (`[SKIP]`). Evolución prevista a **round-robin dirigido por PO (Opción B)** en Fase 8.

---

## 13. Resumen

- Dockerizamos **OpenCode** como motor conectado a **OpenRouter** (gateway único: Gemini Flash/Pro, Claude, GPT... con una sola key).
- Añadimos un **orquestador propio (TS)** que convierte sesiones de OpenCode en **agentes que conversan** (PO, Dev, UX, Validador), con **instancias paralelas** y **bus de mensajes**.
- Persistimos **proyectos/espacios, agentes, conversaciones y métricas**.
- Un **dashboard Angular artesanal** gestiona agentes (skills/hooks/descripción), espacios y conversaciones en vivo.
- Todo **local**, reproducible con `docker compose up`, por **fases con checklist**.
