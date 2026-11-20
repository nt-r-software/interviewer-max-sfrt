// Consumo, estadísticas, historial local, Supabase y fin de sesión.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const d = (m) => require(path.resolve(import.meta.dirname, "../dist/" + m));
const { parseLine, UsageTracker, buildStats } = d("usage.js");
const { appendRecord, loadHistory, aggregate } = d("db.js");
const { syncSession, syncMemory, syncEnabled } = d("sync.js");
const { finalizeSession } = d("finalize.js");
const { SessionLog } = d("sessions.js");

test("parseLine: texto, consumo, límites y errores del stream de Claude", () => {
  assert.deepEqual(parseLine(JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "hola" } } })), { kind: "delta", text: "hola" });
  const u = parseLine(JSON.stringify({ type: "result", duration_ms: 700, total_cost_usd: 0.5, usage: { input_tokens: 1, cache_creation_input_tokens: 2, cache_read_input_tokens: 3, output_tokens: 4 } }));
  assert.deepEqual(u, { kind: "usage", usage: { inputTokens: 6, outputTokens: 4, costUsd: 0.5, durationMs: 700 } });
  const r = parseLine(JSON.stringify({ type: "rate_limit_event", rate_limit_info: { unifiedWindows: { five_hour: { utilization: 0.3, resetsAt: 9 } } } }));
  assert.deepEqual(r.rate.fiveHour, { utilization: 0.3, resetsAt: 9 });
  assert.equal(r.rate.sevenDay, undefined);
  assert.deepEqual(parseLine(JSON.stringify({ type: "result", is_error: true, result: "boom" })), { kind: "error", message: "boom" });
  assert.equal(parseLine("no es json"), null);
  assert.equal(parseLine(JSON.stringify({ type: "system" })), null);
});

test("UsageTracker: take() reparte y reinicia; los límites se conservan y se fusionan", () => {
  const t = new UsageTracker();
  t.record({ bot: "coach", inputTokens: 1, outputTokens: 1, costUsd: 0, durationMs: 1 });
  t.setRate({ fiveHour: { utilization: 0.1, resetsAt: 1 } });
  t.setRate({ sevenDay: { utilization: 0.2, resetsAt: 2 }, fiveHour: undefined });
  assert.equal(t.take().length, 1);
  assert.equal(t.take().length, 0);
  assert.equal(t.rate.fiveHour.utilization, 0.1);
  assert.equal(t.rate.sevenDay.utilization, 0.2);
});

const mkLog = () => {
  const log = new SessionLog();
  log.mode = "simulacro"; log.label = "DevOps";
  log.add({ question: "Q1", answer: "uno dos tres cuatro" });
  log.add({ question: "Q2", answer: "uno dos" });
  log.add({ question: "Q3" });
  return log;
};

test("buildStats: preguntas, respuestas, palabras medias, consumo por bot", () => {
  const log = mkLog();
  const usage = [
    { bot: "coach", inputTokens: 100, outputTokens: 10, costUsd: 0.1, durationMs: 1000 },
    { bot: "coach", inputTokens: 100, outputTokens: 20, costUsd: 0.2, durationMs: 3000 },
    { bot: "resumen", inputTokens: 50, outputTokens: 5, costUsd: 0.05, durationMs: 2000 },
  ];
  const s = buildStats(log, usage, { fiveHour: { utilization: 0.5, resetsAt: 1 } }, new Date(log.started.getTime() + 150000));
  assert.equal(s.questions, 3);
  assert.equal(s.answered, 2);
  assert.equal(s.avgAnswerWords, 3);
  assert.equal(s.minutes, 2.5);
  assert.equal(s.calls, 3);
  assert.equal(s.inputTokens, 250);
  assert.equal(s.outputTokens, 35);
  assert.ok(Math.abs(s.costUsd - 0.35) < 1e-9);
  assert.equal(s.avgMs, 2000);
  assert.deepEqual(s.byBot.coach, { calls: 2, outputTokens: 30, costUsd: 0.30000000000000004 });
  assert.equal(s.rate.fiveHour.utilization, 0.5);
});

test("historial local: guarda, recarga sin duplicar y agrega", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "db-"));
  assert.deepEqual(loadHistory(dir), []);
  const rec = (id, mode, q) => ({ id, date: id, summary: "s", entries: [], mode, label: "", minutes: 2, questions: q, answered: q, avgAnswerWords: 10, calls: 2, inputTokens: 10, outputTokens: 5, costUsd: 0.1, avgMs: 1, byBot: { coach: { calls: 2, outputTokens: 5, costUsd: 0.1 } }, rate: {} });
  appendRecord(dir, rec("a", "simulacro", 3));
  appendRecord(dir, rec("b", "entrevista", 2));
  appendRecord(dir, rec("a", "simulacro", 4)); // misma sesión: reemplaza
  const h = loadHistory(dir);
  assert.equal(h.length, 2);
  const a = aggregate(h);
  assert.equal(a.sessions, 2);
  assert.equal(a.practiceSessions, 1);
  assert.equal(a.questions, 6);
  assert.equal(a.byBot.coach.calls, 4);
  assert.equal(a.avgAnswerWords, 10);
});

test("Supabase: upsert con cabeceras, tablas y cuerpo correctos; errores claros", async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); return new Response("", { status: 201 }); };
  try {
    const cfg = { url: "https://x.supabase.co/", key: "KEY" };
    assert.equal(syncEnabled(cfg), true);
    assert.equal(syncEnabled({ url: "", key: "k" }), false);
    await syncSession(cfg, { id: "i", date: "2026-11-20T10:00:00Z", mode: "simulacro", label: "L", summary: "S", entries: [{ question: "q" }], minutes: 3, questions: 1 });
    await syncMemory(cfg, "MEM");
    assert.equal(calls[0].url, "https://x.supabase.co/rest/v1/sessions?on_conflict=id");
    assert.equal(calls[0].init.headers.apikey, "KEY");
    assert.equal(calls[0].init.headers.Authorization, "Bearer KEY");
    assert.match(calls[0].init.headers.Prefer, /merge-duplicates/);
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.created_at, "2026-11-20T10:00:00Z");
    assert.deepEqual(body.stats, { minutes: 3, questions: 1 });
    assert.equal(calls[1].url, "https://x.supabase.co/rest/v1/memory?on_conflict=id");
    assert.equal(JSON.parse(calls[1].init.body).content, "MEM");
    globalThis.fetch = async () => new Response("relation does not exist", { status: 404 });
    await assert.rejects(syncMemory(cfg, "x"), /Supabase respondió 404: relation does not exist/);
  } finally { globalThis.fetch = realFetch; }
});

function deps(overrides = {}) {
  const sent = [];
  const tracker = new UsageTracker();
  const dir = mkdtempSync(path.join(tmpdir(), "fin-"));
  let memory = "MEM-ANTES";
  return {
    sent, tracker, dir, get memory() { return memory; },
    d: {
      dir, tracker, memory, sync: { url: "", key: "" },
      onMemory: (m) => (memory = m),
      send: (...a) => sent.push(a),
      complete: async (system, _u, onDelta, _s, bot) => {
        tracker.record({ bot, inputTokens: 10, outputTokens: 5, costUsd: 0.01, durationMs: 100 });
        onDelta(system.includes("MEMORIA") ? "**Sesión:** resumen" : "x");
      },
      ...overrides,
    },
  };
}

test("fin de sesión: guarda, resume, actualiza memoria, estadísticas e historial", async () => {
  const x = deps();
  x.tracker.record({ bot: "coach", inputTokens: 100, outputTokens: 20, costUsd: 0.1, durationMs: 1000 });
  await finalizeSession(mkLog(), x.d);
  const chans = x.sent.map((s) => s[0]);
  assert.deepEqual(chans, ["session-status", "session-summary", "session-stats"]);
  assert.match(x.sent[1][1], /resumen/);
  assert.match(x.memory, /MEM-ANTES[\s\S]*resumen/);
  const stats = x.sent[2][1];
  assert.equal(stats.calls, 2); // la llamada previa del coach + el resumen
  assert.equal(stats.questions, 3);
  assert.ok(stats.byBot.resumen && stats.byBot.coach);
  assert.equal(loadHistory(x.dir).length, 1);
  assert.ok(readdirSync(x.dir).some((f) => f.endsWith(".md")));
  assert.match(readFileSync(path.join(x.dir, readdirSync(x.dir).find((f) => f.endsWith(".md"))), "utf8"), /## Resumen/);
});

test("fin de sesión con Supabase: sincroniza sesión y memoria; si falla, avisa y no pierde nada", async () => {
  const realFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (u) => { urls.push(String(u)); return new Response("", { status: 201 }); };
  try {
    const x = deps({ sync: { url: "https://p.supabase.co", key: "K" } });
    await finalizeSession(mkLog(), x.d);
    assert.deepEqual(urls.map((u) => u.split("/rest/v1/")[1]), ["sessions?on_conflict=id", "memory?on_conflict=id"]);
    assert.ok(x.sent.some((s) => s[0] === "session-status" && /Supabase/.test(s[1])));

    globalThis.fetch = async () => new Response("denied", { status: 401 });
    const y = deps({ sync: { url: "https://p.supabase.co", key: "K" } });
    await finalizeSession(mkLog(), y.d);
    assert.ok(y.sent.some((s) => s[0] === "error" && /Supabase respondió 401/.test(s[1])));
    assert.equal(loadHistory(y.dir).length, 1, "el historial local se conserva");
  } finally { globalThis.fetch = realFetch; }
});

test("fin de sesión: si Claude falla al resumir, avisa y aun así guarda y da estadísticas", async () => {
  const x = deps({ complete: async () => { throw new Error("Límite alcanzado"); } });
  await finalizeSession(mkLog(), x.d);
  assert.ok(x.sent.some((s) => s[0] === "error" && /Límite alcanzado/.test(s[1])));
  assert.ok(x.sent.some((s) => s[0] === "session-stats"));
  assert.equal(loadHistory(x.dir)[0].summary, "");
  assert.ok(!x.sent.some((s) => s[0] === "session-summary"));
});
