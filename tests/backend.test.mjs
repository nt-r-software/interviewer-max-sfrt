// Claude vía CLI (stream-json, medición de consumo) e importación de GitHub.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");
const { streamAnswer, complete, setTelemetry } = require(path.join(root, "dist/llm.js"));
const { importGithub } = require(path.join(root, "dist/github.js"));

const settings = { model: "m", profile: "PERFIL-XYZ", githubSummary: "GH-ABC", memory: "MEM-777", jobContext: "", language: "auto" };

// `claude` falso (script node) que habla el mismo formato stream-json que el real.
function fakeClaude(mode = "ok") {
  const dir = mkdtempSync(path.join(tmpdir(), "fakeclaude-"));
  const f = path.join(dir, "claude");
  writeFileSync(f, `#!/usr/bin/env node
let inp = "";
process.stdin.on("data", (d) => (inp += d)).on("end", () => {
  const out = (o) => console.log(JSON.stringify(o));
  if (${JSON.stringify(mode)} === "exit3") { console.error("no hay sesión"); process.exit(3); }
  out({ type: "rate_limit_event", rate_limit_info: { unifiedWindows: { five_hour: { utilization: 0.14, resetsAt: 111 }, seven_day: { utilization: 0.56, resetsAt: 222 } } } });
  if (${JSON.stringify(mode)} === "error") { out({ type: "result", is_error: true, result: "Límite alcanzado" }); process.exit(1); }
  const text = "ARGS:" + process.argv.slice(2).join(" ") + "|PROMPT:" + inp;
  out({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: text.slice(0, 10) } } });
  out({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: text.slice(10) } } });
  out({ type: "result", subtype: "success", is_error: false, result: text, duration_ms: 500, total_cost_usd: 0.01,
        usage: { input_tokens: 2, cache_creation_input_tokens: 10, cache_read_input_tokens: 20, output_tokens: 7 } });
});
`);
  chmodSync(f, 0o755);
  return dir;
}

async function withPath(dir, fn) {
  const old = process.env.PATH;
  process.env.PATH = dir + path.delimiter + old;
  try { return await fn(); } finally { process.env.PATH = old; }
}

test("usa tu sesión de Claude Code: streaming, flags sin herramientas y contexto completo", async () => {
  await withPath(fakeClaude(), async () => {
    let out = "";
    await streamAnswer(settings, [{ speaker: "me", text: "hola" }], "¿Cuál es tu mayor logro?", (d) => (out += d), new AbortController().signal);
    assert.match(out, /--tools\s+--no-session-persistence/);
    assert.match(out, /--output-format stream-json/);
    assert.match(out, /--model m/);
    assert.match(out, /PERFIL-XYZ/);
    assert.match(out, /GH-ABC/);
    assert.match(out, /MEM-777/);
    assert.match(out, /¿Cuál es tu mayor logro\?/);
    assert.match(out, /YO: hola/);
    assert.match(out, /PUENTE HONESTO/);
  });
});

test("mide el consumo y los límites de tu sesión de Claude", async () => {
  await withPath(fakeClaude(), async () => {
    const usage = [], rates = [];
    setTelemetry({ usage: (u) => usage.push(u), rate: (r) => rates.push(r) });
    await streamAnswer(settings, [], "q", () => {}, new AbortController().signal);
    assert.deepEqual(usage, [{ bot: "copiloto", inputTokens: 32, outputTokens: 7, costUsd: 0.01, durationMs: 500 }]);
    assert.equal(rates[0].fiveHour.utilization, 0.14);
    assert.equal(rates[0].sevenDay.utilization, 0.56);
    await complete(settings, "sys", "u", () => {}, new AbortController().signal, "coach");
    assert.equal(usage.at(-1).bot, "coach");
  });
});

test("si Claude devuelve un error, llega su mensaje", async () => {
  await withPath(fakeClaude("error"), async () => {
    await assert.rejects(streamAnswer(settings, [], "q", () => {}, new AbortController().signal), /Límite alcanzado/);
  });
});

test("si el CLI falla, llega su stderr", async () => {
  await withPath(fakeClaude("exit3"), async () => {
    await assert.rejects(streamAnswer(settings, [], "q", () => {}, new AbortController().signal), /no hay sesión/);
  });
});

test("si no existe Claude Code, explica cómo instalarlo", async () => {
  const old = process.env.PATH;
  process.env.PATH = mkdtempSync(path.join(tmpdir(), "empty-"));
  try {
    await assert.rejects(streamAnswer(settings, [], "q", () => {}, new AbortController().signal), /No encuentro Claude Code/);
  } finally { process.env.PATH = old; }
});

test("importa GitHub: ignora forks, ordena lenguajes y recorta README", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    const json = (b) => new Response(JSON.stringify(b), { status: 200 });
    if (u.includes("/repos?")) return json([
      { name: "api", description: "Mi API", language: "TypeScript", fork: false, topics: ["node"] },
      { name: "copiado", description: "fork", language: "Go", fork: true },
      { name: "web", description: "Web", language: "TypeScript", fork: false },
      { name: "script", description: "", language: "Python", fork: false },
    ]);
    if (u.endsWith("/readme")) return new Response("# Título\n" + "x".repeat(2000), { status: 200 });
    return new Response("{}", { status: 404 });
  };
  try {
    const out = await importGithub("octocat", "");
    assert.match(out, /Lenguajes más usados: TypeScript, Python/);
    assert.doesNotMatch(out, /copiado/);
    assert.match(out, /- api \[TypeScript\] Mi API \(node\)/);
    assert.ok(out.length < 2500, "el README debe recortarse");
  } finally { globalThis.fetch = realFetch; }
});

test("importa GitHub: error claro si la API falla", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("", { status: 404 });
  try {
    await assert.rejects(importGithub("noexiste", ""), /GitHub respondió 404/);
    await assert.rejects(importGithub("", ""), /Indica tu usuario/);
  } finally { globalThis.fetch = realFetch; }
});
