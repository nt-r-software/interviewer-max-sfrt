// Registro de sesiones + memoria acumulada. Sin dependencias de Electron para poder probarlo.
import fs from "node:fs";
import path from "node:path";

export type CompleteFn = (system: string, user: string, onDelta: (t: string) => void, signal: AbortSignal, bot?: string) => Promise<void>;

export interface Entry {
  question: string;
  answer?: string; // lo que dijiste tú
  feedback?: string; // simulacro: feedback del coach
  suggestion?: string; // entrevista real: lo que sugirió el copiloto
}

export class SessionLog {
  entries: Entry[] = [];
  mode: "entrevista" | "simulacro" = "entrevista";
  label = "";
  readonly started = new Date();

  add(e: Entry): void {
    this.entries.push(e);
  }

  /** Une lo que dices tú a la última pregunta (entrevista real). */
  attachAnswer(text: string): void {
    const last = this.entries.at(-1);
    if (last) last.answer = ((last.answer ?? "") + " " + text).trim();
  }

  isEmpty(): boolean {
    return this.entries.length === 0;
  }

  toMarkdown(): string {
    const head = `# Sesión de ${this.mode} — ${this.started.toISOString().slice(0, 16).replace("T", " ")}${this.label ? `\n**Puesto/foco:** ${this.label}` : ""}\n`;
    const body = this.entries
      .map((e, i) =>
        [
          `\n## ${i + 1}. ${e.question}`,
          e.answer ? `**Tu respuesta:** ${e.answer}` : "",
          e.feedback ? `**Feedback:**\n${e.feedback}` : "",
          e.suggestion ? `**Sugerencia del copiloto:**\n${e.suggestion}` : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
      )
      .join("\n");
    return head + body + "\n";
  }
}

export const SUMMARY_SYSTEM = `Resume esta sesión de entrevista/entrenamiento para la MEMORIA del coach, que usará esa información en futuras sesiones.
Markdown, máx. 220 palabras, con estas secciones:
**Sesión:** puesto y modo en una línea.
**Fortalezas demostradas:** lo que hizo bien.
**A mejorar:** puntos concretos y accionables.
**Hechos reales nuevos:** logros, cifras, proyectos o historias que ELLA/EL aportó en sus respuestas y que no estén ya en su perfil. Solo lo que dijo; no inventes.
**Huecos:** temas preguntados que NO pudo respaldar con experiencia real. Para cada uno, sugiere que se pregunte si en algún punto REAL de su carrera tocó algo parecido y, solo si es cierto, lo añada a su perfil. No des por hecho que lo hizo.
**Siguiente práctica:** qué entrenar la próxima vez.`;

const COMPRESS_SYSTEM = `Fusiona y condensa estas notas de memoria de un coach de entrevistas. Elimina duplicados, conserva lo más útil (hechos reales aportados, fortalezas, puntos a mejorar recurrentes, práctica pendiente) y ordena por tema. Markdown, máx. 3500 caracteres. Devuelve solo las notas.`;

async function collect(complete: CompleteFn, system: string, user: string): Promise<string> {
  let out = "";
  await complete(system, user, (t) => (out += t), new AbortController().signal, "resumen");
  return out.trim();
}

export function summarize(complete: CompleteFn, log: SessionLog): Promise<string> {
  return collect(complete, SUMMARY_SYSTEM, log.toMarkdown());
}

export async function updateMemory(
  complete: CompleteFn,
  memory: string,
  summary: string,
  date = new Date(),
  max = 6000,
): Promise<string> {
  const merged = `${memory.trim()}\n\n### ${date.toISOString().slice(0, 10)}\n${summary.trim()}`.trim();
  if (merged.length <= max) return merged;
  const compressed = await collect(complete, COMPRESS_SYSTEM, merged);
  return compressed || merged.slice(-max); // si falla la compresión, conserva lo más reciente
}

export function saveLog(dir: string, log: SessionLog): string {
  fs.mkdirSync(dir, { recursive: true });
  const stamp = log.started.toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const file = path.join(dir, `sesion-${stamp}-${log.mode}.md`);
  fs.writeFileSync(file, log.toMarkdown());
  return file;
}
