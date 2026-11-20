import Anthropic from "@anthropic-ai/sdk";
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
  if (!s.anthropicKey) throw new Error("Falta la API key de Anthropic (Ajustes).");
  const client = new Anthropic({ apiKey: s.anthropicKey });

  const context =
    `# PERFIL DE LA PERSONA\n${s.profile || "(vacío)"}\n\n# RESUMEN DE GITHUB\n${s.githubSummary || "(vacío)"}` +
    (s.language !== "auto" ? `\n\nIdioma preferido de respuesta: ${s.language === "es" ? "español" : "inglés"}` : "");

  const convo = history
    .slice(-8)
    .map((t) => `${t.speaker === "them" ? "ENTREVISTADOR" : "YO"}: ${t.text}`)
    .join("\n");

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
          content: `Conversación reciente:\n${convo || "(inicio)"}\n\nPregunta actual del entrevistador:\n${question}\n\nDame las viñetas.`,
        },
      ],
    },
    { signal },
  );
  stream.on("text", onDelta);
  await stream.finalMessage();
}
