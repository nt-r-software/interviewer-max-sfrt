// Sincronización OPCIONAL con tu proyecto de Supabase (plan gratuito). Ver supabase/schema.sql.
import type { SessionRecord } from "./db";

export interface SyncCfg {
  url: string;
  key: string;
}

export const syncEnabled = (c: SyncCfg) => !!(c.url.trim() && c.key.trim());

async function upsert(c: SyncCfg, table: string, row: unknown): Promise<void> {
  const res = await fetch(`${c.url.replace(/\/+$/, "")}/rest/v1/${table}?on_conflict=id`, {
    method: "POST",
    headers: {
      apikey: c.key,
      Authorization: `Bearer ${c.key}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`Supabase respondió ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

export async function syncSession(c: SyncCfg, r: SessionRecord): Promise<void> {
  const { id, date, mode, label, summary, entries, ...stats } = r;
  await upsert(c, "sessions", { id, created_at: date, mode, label, summary, entries, stats });
}

export async function syncMemory(c: SyncCfg, memory: string): Promise<void> {
  await upsert(c, "memory", { id: "main", content: memory, updated_at: new Date().toISOString() });
}
