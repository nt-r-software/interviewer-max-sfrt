import { focusLine, PracticeOptions } from "./jobs";

// Modo simulacro: un bot entrevistador pregunta, escucha tu respuesta y te da feedback.

const ASK_SYSTEM = `Eres un entrevistador profesional que hace un simulacro de entrevista a la persona del perfil.
Haz UNA sola pregunta, natural y breve (máx. 35 palabras), basada en su perfil, sus repos de GitHub y el puesto objetivo si lo hay.
Alterna tipos: comportamiento (situación-acción-resultado), técnica sobre SUS proyectos y stack, motivación / por qué cambia de trabajo, puntos débiles, preguntas incómodas habituales (huecos, salida del empleo actual, expectativas) y, a veces, una repregunta sobre su respuesta anterior.
No repitas preguntas ya hechas. Usa el idioma del puesto/perfil (español si dudas).
Devuelve SOLO la pregunta, sin comillas ni comentarios.`;

const FEEDBACK_SYSTEM = `Eres un coach de entrevistas cercano y honesto. Evalúa la respuesta que la persona acaba de dar en un simulacro.
Formato EXACTO (3 líneas, máx. 70 palabras en total):
✅ <lo mejor de la respuesta>
⚠️ <1-2 mejoras concretas: estructura, concreción, resultados medibles, longitud>
💡 <cómo decirlo mejor en 1-2 frases, usando SOLO hechos reales del perfil / GitHub; nunca inventes>
La persona tiene síndrome del impostor: señala los logros reales que haya infravalorado. Responde en el idioma de su respuesta.`;

type CompleteFn = (system: string, user: string, onDelta: (t: string) => void, signal: AbortSignal, bot?: string) => Promise<void>;

export interface PracticeDeps {
  complete: CompleteFn;
  emit: (channel: string, ...args: unknown[]) => void;
  answerPauseMs?: number; // silencio tras el que se da por terminada la respuesta
  nextDelayMs?: number; // pausa entre el feedback y la siguiente pregunta
  record?: (e: { question: string; answer: string; feedback: string }) => void;
}

export class Practice {
  active = false;
  awaiting = false;
  private buf = "";
  private question = "";
  private asked: string[] = [];
  private focus = "";
  private last: { q: string; a: string } | null = null;
  private timer: NodeJS.Timeout | null = null;
  private abort: AbortController | null = null;
  private gen = 0; // invalida tareas en vuelo al parar/saltar

  constructor(private d: PracticeDeps) {}

  start(opts: PracticeOptions = {}): void {
    this.reset();
    this.asked = [];
    this.last = null;
    this.focus = focusLine(opts);
    this.active = true;
    this.d.emit("practice-state", true);
    void this.nextQuestion();
  }

  stop(): void {
    this.reset();
    this.active = false;
    this.d.emit("practice-state", false);
  }

  /** Texto que dice la persona (voz o escrito). */
  hearMe(text: string): void {
    if (!this.active || !this.awaiting) return;
    this.buf = (this.buf + " " + text).trim();
    this.clearTimer();
    this.timer = setTimeout(() => void this.finishAnswer(), this.d.answerPauseMs ?? 6000);
  }

  /** La persona indica que terminó (botón o texto escrito). */
  async finishAnswer(): Promise<void> {
    if (!this.active || !this.awaiting) return;
    this.clearTimer();
    const answer = this.buf.trim();
    if (!answer) return;
    this.awaiting = false;
    this.buf = "";
    const gen = this.gen;
    const ac = (this.abort = new AbortController());
    this.last = { q: this.question, a: answer };
    this.d.emit("fb-start");
    let fb = "";
    try {
      await this.d.complete(
        FEEDBACK_SYSTEM,
        `${this.focus}\n\nPregunta del entrevistador:\n${this.question}\n\nRespuesta de la persona:\n${answer}`,
        (t) => {
          fb += t;
          if (gen === this.gen) this.d.emit("fb-delta", t);
        },
        ac.signal,
        "coach",
      );
    } catch (e: any) {
      if (gen === this.gen) this.d.emit("error", e?.message ?? String(e));
      return this.failStop(gen);
    }
    if (gen !== this.gen) return;
    this.d.record?.({ question: this.question, answer, feedback: fb.trim() });
    this.d.emit("fb-end");
    setTimeout(() => gen === this.gen && this.active && void this.nextQuestion(), this.d.nextDelayMs ?? 1500);
  }

  skip(): void {
    if (!this.active) return;
    this.reset();
    void this.nextQuestion();
  }

  private async nextQuestion(): Promise<void> {
    const gen = this.gen;
    const ac = (this.abort = new AbortController());
    let q = "";
    this.d.emit("bot-start");
    try {
      await this.d.complete(
        ASK_SYSTEM,
        `${this.focus}\n\n${this.last ? `Último intercambio (puedes hacer una repregunta sobre él si aporta, o pasar a otro tema):\nPregunta: ${this.last.q}\nRespuesta: ${this.last.a}\n\n` : ""}Preguntas ya hechas (no repetir):\n${this.asked.map((x, i) => `${i + 1}. ${x}`).join("\n") || "(ninguna: empieza con una pregunta de calentamiento)"}\n\nHaz la siguiente pregunta.`,
        (t) => {
          q += t;
          if (gen === this.gen) this.d.emit("bot-delta", t);
        },
        ac.signal,
        "entrevistador",
      );
    } catch (e: any) {
      if (gen === this.gen) this.d.emit("error", e?.message ?? String(e));
      return this.failStop(gen);
    }
    if (gen !== this.gen) return;
    this.question = q.trim();
    this.asked.push(this.question);
    this.awaiting = true;
    this.d.emit("bot-end", this.question);
  }

  private failStop(gen: number): void {
    if (gen !== this.gen) return;
    this.reset();
    this.active = false;
    this.d.emit("practice-state", false);
  }

  private reset(): void {
    this.gen++;
    this.clearTimer();
    this.abort?.abort();
    this.abort = null;
    this.awaiting = false;
    this.buf = "";
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
