// E2E de la interfaz en Chromium real: audio falso + `api` y Whisper simulados.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const { chromium } = createRequire(import.meta.url)("playwright");
const root = path.resolve(import.meta.dirname, "..");
const dir = mkdtempSync(path.join(tmpdir(), "imax-"));
const wav = path.join(dir, "speech.wav");

// 2 s de "voz" (tono), 1.5 s de silencio, 2 s de tono, 1.5 s de silencio.
const fmt = "aformat=sample_rates=48000:channel_layouts=mono";
execFileSync("ffmpeg", ["-y", "-loglevel", "error",
  "-f", "lavfi", "-i", "sine=f=300:d=2", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono:d=1.5",
  "-f", "lavfi", "-i", "sine=f=500:d=2", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono:d=1.5",
  "-filter_complex", `[0]${fmt}[a];[1]${fmt}[s];[2]${fmt}[b];[3]${fmt}[t];[a][s][b][t]concat=n=4:v=0:a=1`, wav]);

const MOCKS = `
window.__calls = []; window.__asr = []; window.__handlers = {};
window.__settings = { stt: "local", language: "auto", anthropicKey: "", deepgramKey: "", githubUser: "", githubToken: "",
  model: "x", profile: "", githubSummary: "" };
const rec = (n) => (...a) => { window.__calls.push([n, ...a]); };
window.api = {
  sendAudio: rec("sendAudio"), localTranscript: rec("localTranscript"), saveSettings: async (s) => { window.__calls.push(["saveSettings", s]); return true; },
  getSettings: async () => structuredClone(window.__settings),
  importGithub: async (u) => { window.__calls.push(["importGithub", u]); return "Lenguajes: TypeScript\\n- repo-demo"; },
  startListening: rec("startListening"), stopListening: rec("stopListening"), ask: rec("ask"),
  openSettings: rec("openSettings"), toggleClickThrough: rec("toggleClickThrough"), quit: rec("quit"),
  on: (ch, cb) => { (window.__handlers[ch] ||= []).push(cb); },
};
window.__emit = (ch, ...a) => (window.__handlers[ch] || []).forEach((cb) => cb(...a));
// getDisplayMedia (audio del sistema) -> usamos el micro falso.
navigator.mediaDevices.getDisplayMedia = async () => navigator.mediaDevices.getUserMedia({ audio: true });
// Whisper simulado: registra los segmentos que le llegan.
window.Worker = class {
  postMessage(m) {
    if (m.type === "init") setTimeout(() => this.onmessage({ data: { type: "ready" } }), 30);
    else if (m.type === "asr") {
      window.__asr.push({ speaker: m.speaker, seconds: m.audio.length / 16000, language: m.language });
      const n = window.__asr.length;
      setTimeout(() => this.onmessage({ data: { type: "result", speaker: m.speaker, text: "pregunta de prueba " + n } }), 20);
    }
  }
};`;

let browser;
before(async () => {
  browser = await chromium.launch({ args: [
    "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream",
    "--use-file-for-fake-audio-capture=" + wav, "--autoplay-policy=no-user-gesture-required"] });
});
after(() => browser?.close());

async function open(file, settings = {}) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(MOCKS);
  if (Object.keys(settings).length) await page.addInitScript((s) => Object.assign(window.__settings, s), settings);
  await page.goto(pathToFileURL(path.join(root, "dist/renderer", file)).href);
  page.errors = errors;
  return page;
}
const calls = (page, name) => page.evaluate((n) => window.__calls.filter((c) => c[0] === n), name);

test("arranca solo en modo escucha", async () => {
  const page = await open("overlay.html");
  await page.waitForFunction(() => window.__calls.some((c) => c[0] === "startListening"));
  await page.waitForFunction(() => document.getElementById("status").textContent.includes("escuchando"));
  assert.equal(await page.locator("#listen").textContent(), "■ Parar");
  assert.deepEqual(page.errors, []);
});

test("segmenta el audio por silencios y lo manda a Whisper (sistema + micro)", async () => {
  const page = await open("overlay.html");
  await page.waitForFunction(() => window.__asr.length >= 4, null, { timeout: 25000 });
  const segs = await page.evaluate(() => window.__asr);
  assert.ok(segs.some((s) => s.speaker === "them") && segs.some((s) => s.speaker === "me"));
  for (const s of segs) assert.ok(s.seconds > 1.2 && s.seconds < 5, `segmento de ${s.seconds}s fuera de rango`);
  assert.deepEqual(page.errors, []);
});

test("las transcripciones salen en el chat y se envían al proceso principal", async () => {
  const page = await open("overlay.html");
  await page.waitForSelector(".msg.them .body", { timeout: 25000 });
  await page.waitForSelector(".msg.me .body");
  assert.match(await page.locator(".msg.them .body").first().textContent(), /pregunta de prueba/);
  assert.ok((await calls(page, "localTranscript")).length >= 2);
});

test("respuesta de Claude en streaming dentro del chat", async () => {
  const page = await open("overlay.html");
  await page.evaluate(() => { __emit("answer-start", "q"); __emit("answer-delta", "• En TSB "); });
  assert.ok(await page.locator(".msg.ai.streaming").count());
  await page.evaluate(() => { __emit("answer-delta", "reduje errores un 40 %"); __emit("answer-end"); });
  assert.match(await page.locator(".msg.ai .body").textContent(), /En TSB reduje errores un 40 %/);
  assert.equal(await page.locator(".msg.ai.streaming").count(), 0);
});

test("un error elimina la burbuja a medias y avisa", async () => {
  const page = await open("overlay.html");
  await page.evaluate(() => { __emit("answer-start", "q"); __emit("error", "Falta Claude Code"); });
  assert.equal(await page.locator(".msg.ai").count(), 0);
  assert.match(await page.locator(".msg.err .body").textContent(), /Falta Claude Code/);
});

test("pregunta manual y botón «Responder ya»", async () => {
  const page = await open("overlay.html");
  await page.fill("#manual", "Háblame de ti");
  await page.press("#manual", "Enter");
  assert.deepEqual((await calls(page, "ask")).at(-1), ["ask", "Háblame de ti"]);
  assert.match(await page.locator(".msg.them").last().textContent(), /Háblame de ti/);
  await page.click("#now");
  assert.deepEqual((await calls(page, "ask")).at(-1), ["ask", ""]);
});

test("parar y reanudar la escucha", async () => {
  const page = await open("overlay.html");
  await page.waitForFunction(() => window.__calls.some((c) => c[0] === "startListening"));
  await page.evaluate(() => __emit("listening", true));
  await page.click("#listen"); // parar
  assert.ok((await calls(page, "stopListening")).length >= 1);
  await page.evaluate(() => __emit("listening", false));
  assert.equal(await page.locator("#listen").textContent(), "▶ Escuchar");
});

test("con Deepgram manda PCM16 al proceso principal en vez de usar Whisper", async () => {
  const page = await open("overlay.html", { stt: "deepgram" });
  await page.waitForFunction(() => window.__calls.filter((c) => c[0] === "sendAudio").length >= 4, null, { timeout: 15000 });
  assert.equal(await page.evaluate(() => window.__asr.length), 0);
  await page.evaluate(() => __emit("transcript", { speaker: "them", text: "hola desde deepgram", final: true }));
  assert.match(await page.locator(".msg.them").last().textContent(), /hola desde deepgram/);
});

test("ajustes: carga, importa GitHub y guarda", async () => {
  const page = await open("settings.html", { profile: "Mi CV" });
  await page.waitForFunction(() => document.getElementById("profile").value === "Mi CV");
  await page.fill("#githubUser", "octocat");
  await page.click("#import");
  await page.waitForFunction(() => document.getElementById("githubSummary").value.includes("repo-demo"));
  await page.selectOption("#stt", "deepgram");
  await page.click("#save");
  const saved = (await calls(page, "saveSettings"))[0][1];
  assert.equal(saved.githubUser, "octocat");
  assert.equal(saved.stt, "deepgram");
  assert.match(saved.githubSummary, /repo-demo/);
  assert.equal(saved.profile, "Mi CV");
});
