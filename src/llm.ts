import Anthropic from "@anthropic-ai/sdk";
import { spawn } from "node:child_process";
import { Settings } from "./types";

const SYSTEM = `Eres un coach de entrevistas en tiempo real. La persona a la que ayudas está EN una entrevista ahora mismo y verá tu respuesta en un recuadro muy pequeño.

Reglas:
- Responde en el MISMO idioma que la última pregunta (español o inglés).
- Formato: 2-4 viñetas cortas (máx. ~12 palabras cada una), escritas para que las diga en primera persona. Sin introducciones ni despedidas.
- Usa SOLO hechos presentes en el perfil / GitHub de la persona. Nunca inventes empleos, cifras ni tecnologías. Si el perfil no cubre la pregunta, da un enfoque honesto: reconocer lo que sabe, cómo razonaría y qué haría para aprenderlo.
- Prioriza un ejemplo concreto de su experiencia (situación → acción → resultado) cuando la pregunta sea de comportamiento.
- Si es una pregunta técnica, da la idea clave y 1-2 matices; no un tratado.
- Tono seguro y natural. La persona tiene síndrome del impostor: recuérdale de forma sutil sus logros reales cuando encaje.`;

export interface Turn {
  speaker: "them" | "me";
  text: string;
}

export async function streamAnswer(
  s: Settings,
  history: Turn[],
  question: string,
  onDelta: (t: string) => void,
  signal: AbortSignal,
): Promise<void> {

  const context =
    `# PERFIL DE LA PERSONA\n${s.profile || "(vacío)"}\n\n# RESUMEN DE GITHUB\n${s.githubSummary || "(vacío)"}` +
    (s.language !== "auto" ? `\n\nIdioma preferido de respuesta: ${s.language === "es" ? "español" : "inglés"}` : "");

  const convo = history
    .slice(-8)
    .map((t) => `${t.speaker === "them" ? "ENTREVISTADOR" : "YO"}: ${t.text}`)
    .join("\n");

  const userMsg = `Conversación reciente:\n${convo || "(inicio)"}\n\nPregunta actual del entrevistador:\n${question}\n\nDame las viñetas.`;

  // Sin API key: usa tu Claude ya iniciado en este PC mediante Claude Code (`claude -p`).
  if (!s.anthropicKey) return cliAnswer(s, `${SYSTEM}\n\n${context}\n\n${userMsg}`, onDelta, signal);

  const client = new Anthropic({ apiKey: s.anthropicKey });
  const stream = client.messages.stream(
    {
      model: s.model || "claude-sonnet-5-5",
      max_tokens: 400,
      system: [
        { type: "text", text: SYSTEM },
        { type: "text", text: context, cache_control: { type: "ephemeral" } },
      ],
      messages: [
        {
          role: "user",
          content: userMsg,
        },
      ],
    },
    { signal },
  );
  stream.on("text", onDelta);
  await stream.finalMessage();
}

function cliAnswer(s: Settings, prompt: string, onDelta: (t: string) => void, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = ["-p", "--tools", "", "--no-session-persistence"];
    if (s.model) args.push("--model", s.model);
    const p = spawn("claude", args, { shell: process.platform === "win32", signal });
    let err = "";
    p.stdout.on("data", (d) => onDelta(d.toString()));
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("error", (e: any) =>
      reject(new Error(e.code === "ENOENT" ? "No encuentro Claude Code. Instálalo (npm i -g @anthropic-ai/claude-code) e inicia sesión, o pon una API key en Ajustes." : e.message)),
    );
    p.on("close", (code) => (code === 0 || signal.aborted ? resolve() : reject(new Error(err.trim() || `claude salió con código ${code}`))));
    p.stdin.write(prompt);
    p.stdin.end();
  });
}
