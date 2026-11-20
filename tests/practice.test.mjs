// Lógica del bot entrevistador (modo simulacro) con Claude simulado.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";

const { Practice } = createRequire(import.meta.url)(path.resolve(import.meta.dirname, "../dist/practice.js"));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function setup(overrides = {}) {
  const events = [];
  const prompts = [];
  let n = 0;
  const p = new Practice({
    emit: (ch, ...a) => events.push([ch, ...a]),
    answerPauseMs: 40,
    nextDelayMs: 10,
    complete: async (system, user, onDelta) => {
      prompts.push({ system, user });
      if (overrides.fail && prompts.length === overrides.fail) throw new Error("sin Claude");
      const text = system.includes("entrevistador profesional") ? `Pregunta ${++n}` : "✅ bien\n⚠️ mejora\n💡 dilo así";
      for (const ch of text.match(/.{1,4}/gs)) { onDelta(ch); await wait(1); }
    },
  });
  return { p, events, prompts, names: () => events.map((e) => e[0]) };
}

test("start: el bot hace la primera pregunta y queda esperando tu respuesta", async () => {
  const { p, events, names } = setup();
  p.start();
  await wait(60);
  assert.equal(p.active, true);
  assert.equal(p.awaiting, true);
  assert.deepEqual(names().slice(0, 2), ["practice-state", "bot-start"]);
  assert.deepEqual(events.find((e) => e[0] === "bot-end"), ["bot-end", "Pregunta 1"]);
  p.stop();
});

test("tu respuesta (tras una pausa) recibe feedback y luego llega la siguiente pregunta", async () => {
  const { p, events, prompts, names } = setup();
  p.start();
  await wait(60);
  p.hearMe("En TSB migré el sistema");
  p.hearMe("y reduje errores un 40%"); // fragmentos seguidos se unen
  await wait(300);
  assert.ok(names().includes("fb-start") && names().includes("fb-end"));
  const fb = events.filter((e) => e[0] === "fb-delta").map((e) => e[1]).join("");
  assert.match(fb, /✅ bien/);
  const feedbackPrompt = prompts.find((x) => x.system.includes("coach"));
  assert.match(feedbackPrompt.user, /Pregunta 1/);
  assert.match(feedbackPrompt.user, /migré el sistema y reduje errores un 40%/);
  const endEvents = events.filter((e) => e[0] === "bot-end").map((e) => e[1]);
  assert.deepEqual(endEvents, ["Pregunta 1", "Pregunta 2"]);
  p.stop();
});

test("no repite preguntas: manda la lista de las ya hechas", async () => {
  const { p, prompts } = setup();
  p.start();
  await wait(60);
  p.hearMe("respuesta");
  await wait(300);
  const second = prompts.filter((x) => x.system.includes("entrevistador profesional"))[1];
  assert.match(second.user, /1\. Pregunta 1/);
  p.stop();
});

test("finishAnswer inmediato (botón «Terminé») sin esperar la pausa", async () => {
  const { p, names } = setup();
  p.start();
  await wait(60);
  p.hearMe("respuesta corta");
  await p.finishAnswer();
  assert.ok(names().includes("fb-end"));
  p.stop();
});

test("sin respuesta no hay feedback; y fuera de turno se ignora lo que dices", async () => {
  const { p, names } = setup();
  p.hearMe("nadie pregunta aún");
  p.start();
  p.hearMe("antes de que acabe la pregunta"); // todavía no espera
  await wait(60);
  await p.finishAnswer();
  assert.ok(!names().includes("fb-start"));
  p.stop();
});

test("saltar cambia de pregunta; parar corta todo", async () => {
  const { p, events, names } = setup();
  p.start();
  await wait(60);
  p.skip();
  await wait(60);
  assert.deepEqual(events.filter((e) => e[0] === "bot-end").map((e) => e[1]), ["Pregunta 1", "Pregunta 2"]);
  p.stop();
  const before = events.length;
  await wait(100);
  assert.equal(events.length, before, "no debe emitir nada tras parar");
  assert.equal(names().at(-1), "practice-state");
  assert.equal(p.active, false);
});

test("si Claude falla, avisa y termina el simulacro", async () => {
  const { p, events } = setup({ fail: 1 });
  p.start();
  await wait(60);
  assert.deepEqual(events.find((e) => e[0] === "error"), ["error", "sin Claude"]);
  assert.deepEqual(events.at(-1), ["practice-state", false]);
  assert.equal(p.active, false);
});

test("el trabajo elegido, el tipo y el nivel llegan a las preguntas y al feedback", async () => {
  const { p, prompts } = setup();
  p.start({ job: "devops", kind: "tecnica", level: "senior" });
  await wait(60);
  p.hearMe("Usé Kubernetes y Terraform");
  await p.finishAnswer();
  await wait(60);
  for (const x of prompts) {
    assert.match(x.user, /DevOps\/SRE/);
    assert.match(x.user, /solo preguntas técnicas/);
    assert.match(x.user, /Senior/);
  }
  p.stop();
});

test("puesto personalizado tiene prioridad sobre la lista", async () => {
  const { p, prompts } = setup();
  p.start({ job: "qa", custom: "Tech Lead en startup de pagos" });
  await wait(60);
  assert.match(prompts[0].user, /Tech Lead en startup de pagos/);
  assert.doesNotMatch(prompts[0].user, /QA: estrategia/);
  p.stop();
});

test("la siguiente pregunta recibe el último intercambio para poder repreguntar", async () => {
  const { p, prompts } = setup();
  p.start({});
  await wait(60);
  p.hearMe("Migré el core bancario");
  await p.finishAnswer();
  await wait(80);
  const second = prompts.filter((x) => x.system.includes("entrevistador profesional"))[1];
  assert.match(second.user, /Respuesta: Migré el core bancario/);
  p.stop();
});
