# Interviewer Max

Copiloto de entrevistas para Windows / Mac / Linux. Una ventana pequeña tipo chat, siempre encima de las demás apps, que arranca en modo escucha.

**Todo funciona con tu sesión de Claude (Claude Code). Sin API key y sin cargos extra.** La transcripción es local (Whisper) y gratuita.

## Qué hace

1. **Escucha la llamada** (audio del sistema = entrevistador) y tu micrófono, en español e inglés.
2. **Copiloto** 💭: te sugiere 2-4 viñetas técnicas para responder, con tu perfil, tu GitHub y lo aprendido en sesiones anteriores.
3. **Simulacro** 🎯: un bot te entrevista hablando, escucha tus respuestas y te da feedback. Eliges puesto, tipo y nivel.
4. **✔ Acabado** (botón abajo): guarda la sesión, la resume, entrena a los bots y te muestra estadísticas, incluido cuánto llevas gastado de tu límite de Claude.
5. **📊 Panel**: historial, consumo por bot, memoria del agente y todas tus sesiones.

## Requisitos

- [Claude Code](https://claude.com/claude-code) instalado y con sesión iniciada (`claude` en el PATH).
- Internet (la primera vez descarga el modelo de voz, unos 80 MB).

## Uso

```bash
npm install
npm start          # modo desarrollo
```

Primer arranque: en Ajustes pon tu usuario de GitHub (importa tus repos) y pega tu perfil con 5-8 historias reales (situación → acción → resultado). Cuanto más concreto y real, mejores respuestas.

## Ejecutable

- **Windows, sin instalar nada:** en GitHub → *Actions* → *Build* → *Run workflow* y descarga el `.exe` del artefacto `Interviewer-Max-Windows` (portable e instalador). Se genera solo en cada push.
- **En tu PC:** `npm run dist:win` y encontrarás los `.exe` en `release/`.
- Como el `.exe` no está firmado, Windows SmartScreen puede avisar: «Más información → Ejecutar de todas formas».

## «Acabado»: estadísticas y consumo de Claude

Al pulsar **✔ Acabado** (o terminar un simulacro) ves: duración, preguntas, respuestas y palabras medias, llamadas a Claude, tokens, el equivalente en precio de API (informativo, **no se cobra** con tu suscripción), y el **% usado de tu límite de 5 horas y semanal**. Todo sale del propio Claude Code, sin API key. En la cabecera tienes siempre el porcentaje actual.

## Memoria: los bots aprenden de cada sesión 📚

- Cada sesión se guarda en tu equipo (`sessions/*.md` e `history.json`, en la carpeta de datos de la app).
- Claude la resume: fortalezas, qué mejorar, hechos reales nuevos que aportaste, **huecos** y qué practicar después.
- El resumen se suma a la **memoria** (Ajustes → «Memoria de los bots»), que se compacta sola, y todos los bots la usan.

### Guardado en Supabase (opcional)

Por defecto todo queda en tu equipo. Si quieres copia en la nube (plan gratuito): crea un proyecto en Supabase, ejecuta `supabase/schema.sql` y pega la URL y la clave `service_role` en Ajustes. Es una clave de uso personal: la app la guarda cifrada; no la compartas ni la subas a ningún repo.

## Preguntas sobre cosas que no has hecho

El copiloto **nunca inventa experiencia**. Si te preguntan algo que no consta en tu perfil, construye un **puente honesto**:

1. lo más cercano que sí has hecho (proyecto o rol reales),
2. cómo lo abordarías técnicamente, con términos precisos,
3. una frase sincera tipo «no lo he llevado a producción, pero en X hice algo parecido…».

Además te pregunta «¿Has tocado algo parecido en…?» sobre áreas reales de tu carrera: si de verdad es así, lo añades a tu perfil y a partir de ahí cuenta como experiencia. Los **huecos** que detecta cada sesión se acumulan en la memoria para que los practiques.

## Atajos

| Atajo | Acción |
|---|---|
| Ctrl+Shift+H | Mostrar/ocultar la ventana |
| Ctrl+Shift+C | Modo click-through |
| Ctrl+Shift+Espacio | Responder ya a la última pregunta |
| Ctrl+Shift+S | Ajustes |

## Tests

```bash
npx playwright install chromium   # solo la primera vez
npm test                          # interfaz (Chromium) + lógica
npm run test:app                  # app real de Electron, en Linux con xvfb
```

- `ui`: interfaz en Chromium real con audio falso (arranque, segmentación por silencios, chat, simulacro, estadísticas, panel, ajustes).
- `practice`, `sessions`, `usage`, `backend`: lógica del bot, memoria, consumo, historial, Supabase y Claude vía CLI.
- `electron`: la app empaquetada de verdad, con un `claude` falso.
- No cubren: Whisper real, captura del audio del sistema en Windows ni la voz del bot. Eso solo se valida en tu PC.

## Notas

- Respeta las normas de cada entrevista respecto al uso de ayudas con IA.
- Las claves opcionales (Deepgram, GitHub, Supabase) se guardan cifradas con el almacén del sistema (Electron `safeStorage`).
