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
