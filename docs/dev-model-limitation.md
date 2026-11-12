# Limitación del rol Dev y recomendación de modelos

> Documento operativo. Registra una limitación observada durante las Fases 3-4 y
> recomienda modelos de OpenRouter con buena relación coste/capacidad para el
> rol Developer (y, en general, para turnos de agente intensivos en código).
> Última actualización: 2026-11-12.

---

## 1. La limitación observada

Durante las pruebas end-to-end de las Fases 3 y 4, el modelo actual **`deepseek-v4.1-flash-1017`** (único habilitado en OpenRouter por ahora) se comportó así:

- **PO, UX y Validador**: perfecto. Turnos cortos de razonamiento/texto, rápidos y baratos (~$0.001–0.002 por turno).
- **Developer**: **inconsistente en turnos largos**. Cuando la tarea implica escribir varios ficheros y/o ejecutar tests, el turno a veces **no retorna** (entra en un bucle largo de llamadas a herramientas / razonamiento). Se observó más de una vez.

### Causa raíz
No es un fallo de infraestructura (lo verificamos: sin procesos colgados, sin error de red). Es una **limitación de capacidad del modelo** en tareas agénticas largas: DeepSeek V4.1 Flash es un modelo "flash" (barato y rápido) optimizado para turnos cortos, no para **loops de agente de código** con muchas herramientas encadenadas. En esos casos su fiabilidad de *tool-calling* y su capacidad de "cerrar" la tarea caen.

### Mitigaciones ya aplicadas (no eliminan la causa)
- **Timeout por turno** (`TURN_TIMEOUT_MS`, default 6 min) con `AbortController`: si un turno no responde, se aborta con error en vez de colgar la conversación.
- **Etapa Dev tolerante a fallos**: en paralelo, solo falla si fallan *todas* las instancias.
- **Prompts del Dev acotados**: pedir implementaciones breves reduce la probabilidad del bucle.

> Estas mitigaciones hacen el sistema **robusto** ante el problema, pero la forma
> correcta de **resolverlo** es asignar al rol Dev un modelo más capaz en código.

### 1.b Hallazgo posterior: la causa real era la ejecución de `bash` (no solo el modelo)

Al cambiar el Dev a **MiniMax M3** (mejor agente) el fallo se hizo más frecuente, y el diagnóstico fino reveló la causa raíz verdadera:

- MiniMax, por ser mejor agente, **usa más las herramientas** (lanza comandos `bash` como `ls`, `python3 --version`, ejecutar tests).
- En **OpenCode 1.19.5 dentro del contenedor**, esas tool-calls de `bash` **quedan en estado `running` y no completan**: el turno retorna con la tool a medias y **texto final vacío** → el orquestador lo marca como error.
- Verificado: el comando en sí funciona si se lanza a mano en el contenedor (`docker exec`), pero la **tool de OpenCode** no cierra. Es un problema de la ejecución de tools de esa versión, no del shell ni del modelo.
- DeepSeek Flash lo "escondía" porque usaba `bash` mucho menos.

**Decisión estable adoptada:** **todos los agentes con `bash: deny`**. El Dev escribe código (`edit: allow`) y el Validador hace **revisión estática** (lee y razona, sin ejecutar). Verificado E2E: con MiniMax + `bash: deny`, la conversación FizzBuzz terminó en `done` y el fichero generado funciona. Coste $0.004.

> Trade-off: se pierde la auto-ejecución de tests por los agentes. Para proyectos
> personales es un intercambio razonable (fiabilidad total a cambio de validar el
> código tú o en un paso aparte). Si en el futuro se quiere `bash` de nuevo, hay
> que resolver antes la ejecución de tools de OpenCode (actualizar versión o
> investigar el cuelgue) — ver sección 5.

---

## 2. Qué buscamos en un modelo para el rol Dev

1. **Tool-calling fiable** en loops largos (escribir ficheros, iterar).
2. **Buen rendimiento en benchmarks de agente de código** (SWE-Bench, Terminal-Bench, DeepSWE).
3. **Coste contenido** — objetivo: mantenerse en precios "flash/mini" y no dispararse.
4. Disponibilidad en **OpenRouter** (es nuestro gateway).

> Nota de coste real: en un agente de código, el gasto lo domina el **precio de
> output** y el volumen de *cache reads*, no tanto el input. Prioriza el precio
> de output al comparar.

---

## 3. Recomendaciones (OpenRouter, precios 2026 orientativos)

Precios **por millón de tokens** (input / output). Son orientativos y cambian;
**confírmalos en el momento** con `GET /config/providers` o la ficha del modelo
en openrouter.ai antes de fijar nada.

### Nivel recomendado para el rol Dev (mejor equilibrio capacidad/coste)

| Modelo (OpenRouter) | Precio in / out aprox. | Por qué encaja |
|---------------------|------------------------|----------------|
| **`openrouter/minimax/minimax-m3`** ⭐ | **$0.075 / $0.30** (ruta más barata; media del slug ~$0.23 / $0.96) | **Mejor perfil agéntico para el Dev.** Diseñado para "sustained, multi-step tasks" (no single-turn), tool use, contexto 1M. Benchmarks de agente fuertes: **Terminal-Bench 2.1 = 65.2%** (muy por encima de gpt-6-luna en terminal), Coding Index 58.6, y Elos altos en Design Arena Full-Stack/Webapps/Mobile. Es el que mejor ataca la causa raíz (fallo en loops de agente de código). |
| **`openrouter/openai/gpt-6-luna`** | $0.10 / $0.50 (cache read $0.01) | GPT-6 (sep-2026), contexto 1.1M, tool-calling OpenAI, Vibe Code Bench 81.6%, EU in-region routing. Muy barato y capaz, pero **Terminal-Bench bajo** → menos fiable en loops largos de terminal que MiniMax. |
| **`openrouter/z-ai/glm-5.3-flash`** (o GLM-flash vigente) | ~$0.15 / ~$0.50 | Alternativa open-weight: fuerte en DeepSWE/Terminal-Bench, contexto enorme. |

> **Nota sobre precios en OpenRouter**: un mismo modelo lo sirven varios providers a precios distintos. La ruta **Floor** (más barata) de MiniMax M3 ronda **$0.075/$0.30**, mientras que el **precio medio del slug** es ~$0.23/$0.96. Fija la preferencia de routing (Balanced/Floor) según tu prioridad coste vs. velocidad, y **confirma el precio efectivo** en el panel.

### Si el Dev necesita más potencia (tareas de código complejas)

| Modelo | Precio in / out aprox. | Cuándo |
|--------|------------------------|--------|
| **`openrouter/google/gemini-*-flash`** (Flash vigente) | ~$0.75 / ~$3.75 | Workhorse multimodal: útil si el Dev/UX manejan screenshots, PDFs o specs visuales además de código. |
| **Modelo "frontier" bajo demanda** (Gemini Pro / Claude Sonnet / GPT grande) | varía (output alto) | Solo para el rol Dev y solo en conversaciones difíciles. El coste sube rápido; úsalo selectivamente. |

### Mantener como está (barato) para los demás roles

| Rol | Modelo sugerido |
|-----|-----------------|
| PO / UX / Validador | **`deepseek-v4.1-flash-1017`** (actual) — van perfectos y son los más baratos |
| Dev | **subir** a GPT-5.6 Luna / GLM-5.3-Flash / MiniMax M3 |

---

## 4. Recomendación concreta

1. **Habilita en OpenRouter** uno de: `minimax/minimax-m3` (1ª opción, mejor perfil agéntico, ~$0.075/$0.30 ruta Floor) o `openai/gpt-6-luna` ($0.10/$0.50).
2. **Asigna ese modelo solo al rol Dev** (y opcionalmente al Validador cuando ejecute tests). El diseño ya lo permite: el campo `model` es por `AgentProfile`, editable sin tocar código ni arquitectura.
3. **Deja PO/UX/Validador en DeepSeek Flash** (baratos y suficientes para texto/razonamiento).
4. Revisa el gasto con el límite de crédito del panel de OpenRouter y las métricas de coste del dashboard (Fase 5).

### Cómo aplicarlo (cuando decidas el modelo)
- En el fichero del agente `config/opencode/agents/dev.md`, cambiar el frontmatter:
  ```yaml
  model: openrouter/<vendor>/<modelo-elegido>
  ```
- Añadir el modelo al `provider.openrouter.models` de `config/opencode/opencode.jsonc`.
- Actualizar `orchestrator/src/persistence/seed.ts` (`defaultModel` del perfil `dev`) para que el dashboard lo refleje.
- Recargar: `make build && make up-full` (o `./dc.sh ...`).

---

## 5. Pendiente de confirmar

- Los **slugs y precios exactos** dependen de lo que esté habilitado en **tu** cuenta de OpenRouter y del momento. Verifícalos antes de fijarlos.
- Conviene una prueba A/B: misma conversación con DeepSeek Flash vs el modelo elegido para el Dev, comparando **tasa de éxito** y **coste por conversación completada** (no coste por token).
