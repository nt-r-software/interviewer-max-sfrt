// Fin de sesión: guarda, resume con Claude, actualiza la memoria, calcula estadísticas y sincroniza (opcional).
import fs from "node:fs";
import { appendRecord, SessionRecord } from "./db";
import { CompleteFn, saveLog, SessionLog, summarize, updateMemory } from "./sessions";
import { syncEnabled, syncMemory, syncSession, SyncCfg } from "./sync";
import { buildStats, UsageTracker } from "./usage";

export interface FinalizeDeps {
  complete: CompleteFn;
  tracker: UsageTracker;
  dir: string;
  memory: string;
  onMemory: (m: string) => void;
  sync: SyncCfg;
  send: (channel: string, ...args: unknown[]) => void;
}

export async function finalizeSession(cur: SessionLog, d: FinalizeDeps): Promise<void> {
  const file = saveLog(d.dir, cur);
  d.send("session-status", "resumiendo sesión…");
  let summary = "";
  let memory = d.memory;
  try {
    summary = await summarize(d.complete, cur);
    memory = await updateMemory(d.complete, d.memory, summary);
    d.onMemory(memory);
    fs.appendFileSync(file, `\n## Resumen\n${summary}\n`);
  } catch (e: any) {
    d.send("error", `No pude resumir la sesión: ${e?.message ?? e} (el registro quedó en ${file})`);
  }

  const stats = buildStats(cur, d.tracker.take(), d.tracker.rate);
  const rec: SessionRecord = { ...stats, id: cur.started.toISOString(), date: cur.started.toISOString(), summary, entries: cur.entries };
  appendRecord(d.dir, rec);

  if (summary) d.send("session-summary", summary, file);
  d.send("session-stats", stats);

  if (syncEnabled(d.sync)) {
    try {
      await syncSession(d.sync, rec);
      if (summary) await syncMemory(d.sync, memory);
      d.send("session-status", "guardado también en Supabase ✓");
    } catch (e: any) {
      d.send("error", `Supabase: ${e?.message ?? e} (todo sigue guardado en tu equipo)`);
    }
  }
}
