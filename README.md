# Interviewer Max

Copiloto de entrevistas (Windows / Mac / Linux). Una ventana pequeña tipo chat, siempre encima, que arranca en modo escucha:

1. Captura el audio de la llamada (sistema = entrevistador) y tu micro, y lo transcribe en español e inglés.
2. **Whisper local por defecto: sin claves**, solo internet la primera vez (modelo ~80 MB). Deepgram es opcional.
3. Claude «piensa» en el chat qué decir (2-4 viñetas) usando tu perfil y tus repos de GitHub.
4. **Sin API key de Anthropic**: si no pones ninguna, usa tu sesión de Claude Code (`claude` instalado y con login).

## Uso

```bash
npm install
npm start          # modo desarrollo
npm run dist:win   # genera el .exe (portable + instalador) en release/
```

Primer arranque: en Ajustes pon tu usuario de GitHub (importa tus repos) y pega tu perfil/historias.
No hace falta ninguna clave si tienes Claude Code instalado e iniciado.

## Modo simulacro 🎯

Botón «🎯 Simulacro»: eliges **trabajo** (backend, frontend, DevOps, datos, QA, PM, banca/fintech, soporte… o uno propio), **tipo** (mixta, RR. HH., técnica) y **nivel**. Un bot entrevistador, con tu perfil y tu GitHub:

1. Te hace una pregunta **hablando** (y por escrito).
2. Escucha tu respuesta (micro) y, cuando haces una pausa o pulsas «Terminé», te da feedback hablado: ✅ lo mejor · ⚠️ qué mejorar · 💡 cómo decirlo mejor con tus hechos reales.
3. Pasa a la siguiente pregunta, a veces repreguntando sobre lo que dijiste. Puedes saltar, terminar o responder escribiendo.

Para entrenar distintos puestos, repite el simulacro cambiando el trabajo.

## Memoria: los bots aprenden de cada sesión 📚

- Cada entrevista y simulacro se guarda como `.md` (en la carpeta `sessions` de los datos de la app).
- Al terminar un simulacro, o al pulsar **📚 Resumen**, Claude resume la sesión: fortalezas, qué mejorar, hechos reales nuevos que aportaste y qué practicar después.
- Ese resumen se suma a la **memoria** (Ajustes → «Memoria de los bots»), que se compacta sola si crece, y todos los bots la usan para personalizar preguntas, sugerencias y feedback.
- Botón **Copiar resumen** para pegarlo en un chat con Claude; también puedes subir los `.md` a un repo y pedirle que los lea.

## Atajos

| Atajo | Acción |
|---|---|
| Ctrl+Shift+H | Mostrar/ocultar overlay |
| Ctrl+Shift+C | Modo click-through (el ratón atraviesa el overlay) |
| Ctrl+Shift+Espacio | Responder ya a la última pregunta |
| Ctrl+Shift+S | Ajustes |

También puedes escribir la pregunta en la caja de texto del overlay.

## Notas

- Las claves se guardan cifradas con el almacén del sistema (Electron `safeStorage`).
- Respeta las normas de cada entrevista respecto al uso de ayudas con IA.

## Tests

```bash
npx playwright install chromium   # solo la primera vez
npm test
```

- `tests/ui.test.mjs`: interfaz en Chromium real con audio falso (arranque, segmentación por silencios, chat, streaming, errores, ajustes). Whisper y el proceso principal van simulados.
- `tests/practice.test.mjs`: lógica del bot entrevistador (turnos, feedback, repreguntas, puesto/nivel, errores).
- `tests/sessions.test.mjs`: registro de sesiones, resúmenes y memoria acumulada.
- `tests/backend.test.mjs`: Claude vía CLI (éxito, fallo, no instalado) e importación de GitHub.
- No cubren: Whisper real, captura de audio del sistema en Windows ni el overlay de Electron.
