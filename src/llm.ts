import { spawn } from "node:child_process";
import { RateInfo, parseLine, Usage } from "./usage";
import { Settings } from "./types";

const SYSTEM = `Eres un coach de entrevistas en tiempo real. La persona a la que ayudas está EN una entrevista ahora mismo y verá tu respuesta en un recuadro muy pequeño.

Reglas:
- Responde en el MISMO idioma que la última pregunta (español o inglés).
- Formato: 2-4 viñetas cortas (máx. ~15 palabras cada una), escritas para que las diga en primera persona, con vocabulario TÉCNICO preciso (conceptos, herramientas, trade-offs). Sin introducciones ni despedidas.
- Usa SOLO hechos reales presentes en el perfil, GitHub y aprendizajes de la persona. NUNCA inventes empleos, proyectos, cifras ni tecnologías, ni afirmes que hizo algo que no consta.
- Si la pregunta NO está cubierta por su experiencia, construye un PUENTE HONESTO: (1) lo más cercano que sí hizo, nombrando el proyecto o rol real; (2) cómo lo abordaría técnicamente, con términos exactos; (3) una frase sincera tipo «no lo he llevado a producción, pero en X hice algo parecido…».
- En ese caso añade al final UNA línea «❓ ¿Has tocado algo parecido en…?» con 1-2 áreas reales de su carrera donde podría existir relación, para que lo confirme por su cuenta (no lo des por hecho).
- Prioriza un ejemplo concreto (situación → acción → resultado) cuando la pregunta sea de comportamiento.
- Tono seguro y natural. La persona tiene síndrome del impostor: recuérdale de forma sutil sus logros reales cuando encaje.`;

export interface Turn {
  speaker: "them" | "me";
  text: string;
}

// Telemetría: el consumo de tu sesión de Claude se mide con lo que devuelve el propio CLI.
let usageSink: (u: Usage) => void = () => {};
let rateSink: (r: RateInfo) => void = () => {};
export function setTelemetry(t: { usage?: (u: Usage) => void; rate?: (r: RateInfo) => void }): void {
  if (t.usage) usageSink = t.usage;
  if (t.rate) rateSink = t.rate;
}

export function profileContext(s: Settings): string {
  return (
    `# PERFIL DE LA PERSONA\n${s.profile || "(vacío)"}\n\n# RESUMEN DE GITHUB\n${s.githubSummary || "(vacío)"}` +
    (s.memory ? `\n\n# APRENDIZAJES DE SESIONES ANTERIORES (úsalos para personalizar)\n${s.memory}` : "") +
    (s.jobContext ? `\n\n# PUESTO / OFERTA A LA QUE APLICA\n${s.jobContext}` : "") +
    (s.language !== "auto" ? `\n\nIdioma preferido: ${s.language === "es" ? "español" : "inglés"}` : "")
  );
}

/** Llamada a Claude con TU sesión de Claude Code (`claude -p`): sin API key ni cargos extra. */
export function complete(
  s: Settings,
  system: string,
  userMsg: string,
  onDelta: (t: string) => void,
  signal: AbortSignal,
  bot = "otro",
): Promise<void> {
  const prompt = `${system}\n\n${profileContext(s)}\n\n${userMsg}`;
  return new Promise((resolve, reject) => {
    // En Windows, con shell, un argumento vacío hay que pasarlo entrecomillado.
    const empty = process.platform === "win32" ? '""' : "";
    const args = [
      "-p", "--tools", empty, "--no-session-persistence",
      "--output-format", "stream-json", "--verbose", "--include-partial-messages",
    ];
    if (s.model) args.push("--model", s.model);
    const p = spawn("claude", args, { shell: process.platform === "win32", signal });

    let buf = "";
    let err = "";
    let claudeError = "";
    const handle = (line: string) => {
      const ev = parseLine(line.trim());
      if (!ev) return;
      if (ev.kind === "delta") onDelta(ev.text);
      else if (ev.kind === "usage") usageSink({ bot, ...ev.usage });
      else if (ev.kind === "rate") rateSink(ev.rate);
      else claudeError = ev.message;
    };
    p.stdout.on("data", (d) => {
      buf += d.toString();
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      lines.forEach(handle);
    });
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("error", (e: any) =>
      reject(new Error(e.code === "ENOENT" ? "No encuentro Claude Code. Instálalo (npm i -g @anthropic-ai/claude-code) e inicia sesión con tu cuenta de Claude." : e.message)),
    );
    p.on("close", (code) => {
      if (buf.trim()) handle(buf);
      if (signal.aborted) return resolve();
      if (claudeError || code !== 0) return reject(new Error(claudeError || err.trim() || `claude salió con código ${code}`));
      resolve();
    });
    p.stdin.write(prompt);
    p.stdin.end();
  });
}

export async function streamAnswer(
  s: Settings,
  history: Turn[],
  question: string,
  onDelta: (t: string) => void,
  signal: AbortSignal,
): Promise<void> {
  const convo = history
    .slice(-8)
    .map((t) => `${t.speaker === "them" ? "ENTREVISTADOR" : "YO"}: ${t.text}`)
    .join("\n");
  const userMsg = `Conversación reciente:\n${convo || "(inicio)"}\n\nPregunta actual del entrevistador:\n${question}\n\nDame las viñetas.`;
  return complete(s, SYSTEM, userMsg, onDelta, signal, "copiloto");
}
