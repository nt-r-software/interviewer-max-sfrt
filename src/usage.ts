// Medición del consumo de tu sesión de Claude (vía Claude Code, sin API key). Sin dependencias de Electron.
import type { Entry } from "./sessions";

export interface Usage {
  bot: string; // copiloto | entrevistador | coach | resumen
  inputTokens: number; // incluye caché
  outputTokens: number;
  costUsd: number; // equivalente a precio de API: NO se cobra con suscripción
  durationMs: number;
}

export interface RateWindow {
  utilization: number; // 0..1 del límite de la ventana
  resetsAt: number; // epoch s
}
export interface RateInfo {
  fiveHour?: RateWindow;
  sevenDay?: RateWindow;
}

export type StreamEvent =
  | { kind: "delta"; text: string }
  | { kind: "usage"; usage: Omit<Usage, "bot"> }
  | { kind: "rate"; rate: RateInfo }
  | { kind: "error"; message: string };

/** Interpreta una línea de `claude -p --output-format stream-json --include-partial-messages`. */
export function parseLine(line: string): StreamEvent | null {
  let d: any;
  try {
    d = JSON.parse(line);
  } catch {
    return null;
  }
  if (d.type === "stream_event" && d.event?.type === "content_block_delta" && d.event.delta?.type === "text_delta")
    return { kind: "delta", text: d.event.delta.text };
  if (d.type === "result") {
    if (d.is_error) return { kind: "error", message: String(d.result ?? "Error de Claude") };
    const u = d.usage ?? {};
    return {
      kind: "usage",
      usage: {
        inputTokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
        outputTokens: u.output_tokens ?? 0,
        costUsd: d.total_cost_usd ?? 0,
        durationMs: d.duration_ms ?? 0,
      },
    };
  }
  if (d.type === "rate_limit_event") {
    const w = d.rate_limit_info?.unifiedWindows ?? {};
    const pick = (x: any): RateWindow | undefined =>
      x && typeof x.utilization === "number" ? { utilization: x.utilization, resetsAt: x.resetsAt } : undefined;
    return { kind: "rate", rate: { fiveHour: pick(w.five_hour), sevenDay: pick(w.seven_day) } };
  }
  return null;
}

export class UsageTracker {
  private list: Usage[] = [];
  rate: RateInfo = {};
  record(u: Usage): void {
    this.list.push(u);
  }
  setRate(r: RateInfo): void {
    this.rate = { ...this.rate, ...Object.fromEntries(Object.entries(r).filter(([, v]) => v)) };
  }
  /** Devuelve lo acumulado y empieza de cero (una sesión = un reparto). */
  take(): Usage[] {
    const out = this.list;
    this.list = [];
    return out;
  }
}

export interface Stats {
  mode: string;
  label: string;
  minutes: number;
  questions: number;
  answered: number;
  avgAnswerWords: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  avgMs: number;
  byBot: Record<string, { calls: number; outputTokens: number; costUsd: number }>;
  rate: RateInfo;
}

export function buildStats(
  s: { mode: string; label: string; started: Date; entries: Entry[] },
  usage: Usage[],
  rate: RateInfo,
  now = new Date(),
): Stats {
  const answers = s.entries.filter((e) => e.answer);
  const words = answers.map((e) => e.answer!.split(/\s+/).filter(Boolean).length);
  const byBot: Stats["byBot"] = {};
  for (const u of usage) {
    const b = (byBot[u.bot] ??= { calls: 0, outputTokens: 0, costUsd: 0 });
    b.calls++;
    b.outputTokens += u.outputTokens;
    b.costUsd += u.costUsd;
  }
  const sum = (f: (u: Usage) => number) => usage.reduce((a, u) => a + f(u), 0);
  return {
    mode: s.mode,
    label: s.label,
    minutes: Math.max(0.1, Math.round(((now.getTime() - s.started.getTime()) / 60000) * 10) / 10),
    questions: s.entries.length,
    answered: answers.length,
    avgAnswerWords: words.length ? Math.round(words.reduce((a, b) => a + b, 0) / words.length) : 0,
    calls: usage.length,
    inputTokens: sum((u) => u.inputTokens),
    outputTokens: sum((u) => u.outputTokens),
    costUsd: sum((u) => u.costUsd),
    avgMs: usage.length ? Math.round(sum((u) => u.durationMs) / usage.length) : 0,
    byBot,
    rate,
  };
}
