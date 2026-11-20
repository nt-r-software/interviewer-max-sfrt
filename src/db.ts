// Historial local en JSON (gratis, sin configurar). Sin dependencias de Electron.
import fs from "node:fs";
import path from "node:path";
import type { Entry } from "./sessions";
import type { Stats } from "./usage";

export interface SessionRecord extends Stats {
  id: string;
  date: string; // ISO
  summary: string;
  entries: Entry[];
}

const file = (dir: string) => path.join(dir, "history.json");

export function loadHistory(dir: string): SessionRecord[] {
  try {
    return JSON.parse(fs.readFileSync(file(dir), "utf8"));
  } catch {
    return [];
  }
}

export function appendRecord(dir: string, rec: SessionRecord): void {
  fs.mkdirSync(dir, { recursive: true });
  const all = loadHistory(dir).filter((r) => r.id !== rec.id);
  all.push(rec);
  fs.writeFileSync(file(dir), JSON.stringify(all, null, 1));
}

export function aggregate(h: SessionRecord[]) {
  const byBot: Record<string, { calls: number; outputTokens: number; costUsd: number }> = {};
  for (const r of h)
    for (const [bot, v] of Object.entries(r.byBot)) {
      const b = (byBot[bot] ??= { calls: 0, outputTokens: 0, costUsd: 0 });
      b.calls += v.calls;
      b.outputTokens += v.outputTokens;
      b.costUsd += v.costUsd;
    }
  const sum = (f: (r: SessionRecord) => number) => h.reduce((a, r) => a + f(r), 0);
  const practice = h.filter((r) => r.mode === "simulacro");
  return {
    sessions: h.length,
    practiceSessions: practice.length,
    questions: sum((r) => r.questions),
    answered: sum((r) => r.answered),
    minutes: Math.round(sum((r) => r.minutes)),
    calls: sum((r) => r.calls),
    inputTokens: sum((r) => r.inputTokens),
    outputTokens: sum((r) => r.outputTokens),
    costUsd: sum((r) => r.costUsd),
    avgAnswerWords: h.length ? Math.round(sum((r) => r.avgAnswerWords) / h.length) : 0,
    byBot,
  };
}
