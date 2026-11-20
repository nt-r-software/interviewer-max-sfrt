// Lógica del proceso principal sin Electron: Claude vía CLI y GitHub.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");
const { streamAnswer } = require(path.join(root, "dist/llm.js"));
const { importGithub } = require(path.join(root, "dist/github.js"));

const settings = { anthropicKey: "", model: "m", profile: "PERFIL-XYZ", githubSummary: "GH-ABC", language: "auto" };

function fakeClaude(body) {
  const dir = mkdtempSync(path.join(tmpdir(), "fakeclaude-"));
  const f = path.join(dir, "claude");
  writeFileSync(f, `#!/bin/sh\n${body}\n`);
  chmodSync(f, 0o755);
  return dir;
}

test("sin API key usa el CLI de Claude con perfil, GitHub e historial", async () => {
  const dir = fakeClaude('echo "ARGS:$*"; cat');
  const old = process.env.PATH;
  process.env.PATH = dir + path.delimiter + old;
  try {
    let out = "";
    await streamAnswer(settings, [{ speaker: "me", text: "hola" }], "¿Cuál es tu mayor logro?", (d) => (out += d), new AbortController().signal);
    assert.match(out, /--tools/);
    assert.match(out, /PERFIL-XYZ/);
    assert.match(out, /GH-ABC/);
    assert.match(out, /¿Cuál es tu mayor logro\?/);
    assert.match(out, /YO: hola/);
  } finally { process.env.PATH = old; }
});

test("si el CLI falla, el error llega con su mensaje", async () => {
  const dir = fakeClaude('echo "no hay sesión" >&2; exit 3');
  const old = process.env.PATH;
  process.env.PATH = dir + path.delimiter + old;
  try {
    await assert.rejects(streamAnswer(settings, [], "q", () => {}, new AbortController().signal), /no hay sesión/);
  } finally { process.env.PATH = old; }
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
