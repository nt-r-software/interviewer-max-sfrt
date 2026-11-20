// Registro de sesiones, resumen y memoria acumulada.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");
const { SessionLog, summarize, updateMemory, saveLog } = require(path.join(root, "dist/sessions.js"));
const { profileContext } = require(path.join(root, "dist/llm.js"));
const { Practice } = require(path.join(root, "dist/practice.js"));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const fake = (text, seen = []) => async (system, user, onDelta) => { seen.push({ system, user }); onDelta(text); };

test("el registro genera markdown con preguntas, respuestas, feedback y sugerencias", () => {
  const log = new SessionLog();
  log.mode = "simulacro"; log.label = "DevOps · senior";
  log.add({ question: "¿Cuál es tu mayor logro?", answer: "Migré el core", feedback: "✅ claro" });
  log.add({ question: "Why us?", suggestion: "• Fintech fit" });
  const md = log.toMarkdown();
  assert.match(md, /Sesión de simulacro/);
  assert.match(md, /DevOps · senior/);
  assert.match(md, /Tu respuesta:\*\* Migré el core/);
  assert.match(md, /Feedback:\*\*\n✅ claro/);
  assert.match(md, /Sugerencia del copiloto:\*\*\n• Fintech fit/);
});

test("en entrevista real, lo que dices se une a la última pregunta", () => {
  const log = new SessionLog();
  log.attachAnswer("sin pregunta todavía"); // no rompe
  log.add({ question: "Háblame de ti", suggestion: "•" });
  log.attachAnswer("Soy ingeniero"); log.attachAnswer("con 4 años");
  assert.equal(log.entries[0].answer, "Soy ingeniero con 4 años");
  assert.equal(log.isEmpty(), false);
});

test("el resumen se pide con la sesión completa y su formato", async () => {
  const seen = [];
  const log = new SessionLog(); log.add({ question: "Q1", answer: "A1" });
  const out = await summarize(fake("**Sesión:** ok", seen), log);
  assert.equal(out, "**Sesión:** ok");
  assert.match(seen[0].system, /Hechos reales nuevos/);
  assert.match(seen[0].user, /A1/);
});

test("la memoria acumula resúmenes con fecha y no llama a Claude si cabe", async () => {
  const seen = [];
  const m = await updateMemory(fake("NO", seen), "### 2026-01-01\nantes", "nuevo", new Date("2026-11-20T10:00:00Z"));
  assert.match(m, /antes/);
  assert.match(m, /### 2026-11-20\nnuevo/);
  assert.equal(seen.length, 0);
});

test("si la memoria crece demasiado se condensa con Claude", async () => {
  const seen = [];
  const m = await updateMemory(fake("MEMORIA CONDENSADA", seen), "x".repeat(6000), "nuevo");
  assert.equal(m, "MEMORIA CONDENSADA");
  assert.match(seen[0].system, /Fusiona y condensa/);
});

test("si falla la compresión, conserva lo más reciente", async () => {
  const m = await updateMemory(fake(""), "x".repeat(7000), "LO ÚLTIMO");
  assert.ok(m.length <= 6000);
  assert.match(m, /LO ÚLTIMO$/);
});

test("guarda el registro en un archivo .md", () => {
  const dir = path.join(mkdtempSync(path.join(tmpdir(), "ses-")), "sessions");
  const log = new SessionLog(); log.add({ question: "Q", answer: "A" });
  const file = saveLog(dir, log);
  assert.match(file, /sesion-.*-entrevista\.md$/);
  assert.match(readFileSync(file, "utf8"), /Tu respuesta:\*\* A/);
});

test("la memoria llega al contexto de todos los bots", () => {
  const ctx = profileContext({ profile: "P", githubSummary: "G", memory: "MEM-123", jobContext: "", language: "auto" });
  assert.match(ctx, /APRENDIZAJES DE SESIONES ANTERIORES[\s\S]*MEM-123/);
  assert.doesNotMatch(profileContext({ profile: "P", githubSummary: "G", memory: "", jobContext: "", language: "auto" }), /APRENDIZAJES/);
});

test("el simulacro registra cada intercambio pregunta/respuesta/feedback", async () => {
  const records = [];
  const p = new Practice({
    emit() {}, answerPauseMs: 20, nextDelayMs: 5000, record: (e) => records.push(e),
    complete: async (system, _u, onDelta) => onDelta(system.includes("entrevistador profesional") ? "¿Qué hiciste?" : "✅ bien"),
  });
  p.start({});
  await wait(40);
  p.hearMe("Migré el core");
  await wait(120);
  assert.deepEqual(records, [{ question: "¿Qué hiciste?", answer: "Migré el core", feedback: "✅ bien" }]);
  p.stop();
});
