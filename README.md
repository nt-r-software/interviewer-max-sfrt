# Interviewer Max

Copiloto de entrevistas (Windows / Mac / Linux). Overlay pequeño siempre encima de todas las apps que:

1. Escucha al entrevistador (audio del sistema) y a ti (micrófono) en español e inglés.
2. Usa tu perfil + resumen de tus repos de GitHub como contexto.
3. Te muestra 2-4 viñetas breves con la respuesta, generadas por Claude.

## Uso

```bash
npm install
npm start          # modo desarrollo
npm run dist:win   # genera el .exe (portable + instalador) en release/
```

Primer arranque: abre Ajustes y pon tu API key de Anthropic, tu API key de Deepgram,
tu usuario de GitHub (importa tus repos) y pega tu perfil/historias.

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
