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

---

## 2. Qué buscamos en un modelo para el rol Dev

1. **Tool-calling fiable** en loops largos (escribir ficheros, ejecutar comandos, iterar).
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
| **`openrouter/openai/gpt-5.6-luna`** (o la mini vigente) | ~$0.20 / ~$1.20 | Mejor "todo-terreno" barato para agente de código: alto Coding-Agent-Index, tool ecosystem OpenAI, contexto ~1M. **Primera opción si está disponible.** |
| **`openrouter/z-ai/glm-5.3-flash`** (o GLM-flash vigente) | ~$0.15 / ~$0.50 | Mejor open-weight económico: fuerte en DeepSWE/Terminal-Bench, contexto enorme. Excelente coste/output. |
| **`openrouter/minimax/minimax-m3`** | ~$0.30 / ~$1.20 | Open-weight **diseñado para ejecución de agentes** (buen MCP/tool use). Alternativa sólida si GLM no convence. |

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

1. **Habilita en OpenRouter** uno de: `gpt-5.6-luna` (1ª opción) o `glm-5.3-flash` (mejor coste).
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
