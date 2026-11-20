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
  openSettings: rec("openSettings"), openDashboard: rec("openDashboard"), endSession: rec("endSession"),
  getDashboard: async () => window.__dash, practiceStart: rec("practiceStart"), practiceStop: rec("practiceStop"), practiceDone: rec("practiceDone"), practiceSkip: rec("practiceSkip"), toggleClickThrough: rec("toggleClickThrough"), quit: rec("quit"),
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
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: [
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

test("simulacro: el bot pregunta (hablando), se pausa el micro y se muestra el feedback", async () => {
  const page = await open("overlay.html");
  await page.evaluate(() => {
    window.__spoken = [];
    window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: {
      cancel() {}, speak(u) { window.__spoken.push(u.text); window.__utter = u; } } });
  });
  await page.waitForFunction(() => window.__calls.some((c) => c[0] === "startListening"));
  await page.evaluate(() => __emit("listening", true));
  await page.click("#practice");
  assert.equal(await page.locator("#picker").isVisible(), true);
  assert.ok((await page.locator("#pjob option").count()) >= 10, "debe haber varios trabajos para entrenar");
  await page.selectOption("#pjob", "devops");
  await page.selectOption("#pkind", "tecnica");
  await page.selectOption("#plevel", "senior");
  await page.click("#pgo");
  await page.waitForFunction(() => window.__calls.some((c) => c[0] === "practiceStart"));
  assert.deepEqual((await calls(page, "practiceStart"))[0][1], { job: "devops", custom: "", kind: "tecnica", level: "senior" });
  await page.evaluate(() => __emit("practice-state", true));
  assert.equal(await page.locator("#pbar").isVisible(), true);

  await page.evaluate(() => { __emit("bot-start"); __emit("bot-delta", "¿Por qué "); __emit("bot-delta", "te vas de TSB?"); __emit("bot-end", "¿Por qué te vas de TSB?"); });
  assert.match(await page.locator(".msg.bot .body").textContent(), /¿Por qué te vas de TSB\?/);
  assert.deepEqual(await page.evaluate(() => window.__spoken), ["¿Por qué te vas de TSB?"]);

  // Mientras el bot habla no se envían segmentos a Whisper.
  const before = await page.evaluate(() => window.__asr.length);
  await page.waitForTimeout(3500);
  assert.equal(await page.evaluate(() => window.__asr.length), before, "el micro debe estar en pausa mientras habla");
  await page.evaluate(() => window.__utter.onend()); // el bot termina de hablar
  await page.waitForTimeout(900);

  await page.evaluate(() => { __emit("fb-start"); __emit("fb-delta", "✅ claro\n⚠️ más datos"); __emit("fb-end"); });
  assert.match(await page.locator(".msg.fb .body").textContent(), /✅ claro/);
  const spoken = await page.evaluate(() => window.__spoken);
  assert.equal(spoken.length, 2, "el bot también dice el feedback en voz");
  assert.doesNotMatch(spoken[1], /✅|⚠️/);

  await page.click("#pdone");
  await page.click("#pskip");
  assert.equal((await calls(page, "practiceDone")).length, 1);
  assert.equal((await calls(page, "practiceSkip")).length, 1);
  await page.click("#pend");
  await page.evaluate(() => __emit("practice-state", false));
  assert.equal(await page.locator("#pbar").isVisible(), false);
  assert.deepEqual(page.errors, []);
});

test("simulacro: lo que escribes cuenta como tu respuesta", async () => {
  const page = await open("overlay.html");
  await page.evaluate(() => __emit("practice-state", true));
  await page.fill("#manual", "Lideré la migración");
  await page.press("#manual", "Enter");
  assert.match(await page.locator(".msg.me").last().textContent(), /Lideré la migración/);
  assert.deepEqual((await calls(page, "ask")).at(-1), ["ask", "Lideré la migración"]);
});

test("resumen de sesión: botón, estado, burbuja con ruta y copiar", async () => {
  const page = await open("overlay.html");
  await page.evaluate(() => {
    window.__copied = "";
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (t) => { window.__copied = t; } } });
  });
  await page.click("#finish");
  assert.equal((await calls(page, "endSession")).length, 1);
  await page.evaluate(() => __emit("session-status", "resumiendo sesión…"));
  assert.equal(await page.locator("#status").textContent(), "resumiendo sesión…");
  await page.evaluate(() => __emit("session-summary", "**Fortalezas:** claridad", "/ruta/sesion.md"));
  assert.match(await page.locator(".msg.sum .body").textContent(), /Fortalezas/);
  assert.match(await page.locator(".msg.sum").textContent(), /\/ruta\/sesion\.md/);
  await page.click(".msg.sum button");
  assert.equal(await page.evaluate(() => window.__copied), "**Fortalezas:** claridad");
});

test("ajustes: la memoria se carga y se guarda", async () => {
  const page = await open("settings.html", { memory: "### 2026-11-20\nbuen STAR" });
  await page.waitForFunction(() => document.getElementById("memory").value.includes("buen STAR"));
  await page.fill("#memory", "### editada");
  await page.click("#save");
  assert.equal((await calls(page, "saveSettings"))[0][1].memory, "### editada");
});

test("«✔ Acabado» está abajo y lanza el cierre; salen estadísticas y tu consumo de Claude", async () => {
  const page = await open("overlay.html");
  const box = await page.locator("#finish").boundingBox();
  const vh = page.viewportSize().height;
  assert.ok(box.y + box.height >= vh - 2, "el botón debe quedar pegado al borde inferior");
  await page.click("#finish");
  assert.equal((await calls(page, "endSession")).length, 1);
  await page.evaluate(() => __emit("rate", { fiveHour: { utilization: 0.14, resetsAt: 1 }, sevenDay: { utilization: 0.56, resetsAt: 2 } }));
  assert.match(await page.locator("#rate").textContent(), /5 h: 14% · semana: 56%/);
  await page.evaluate(() => __emit("session-stats", {
    minutes: 12.5, questions: 6, answered: 5, avgAnswerWords: 48, calls: 11, avgMs: 2400, inputTokens: 12000, outputTokens: 900, costUsd: 0.37,
    byBot: { coach: { calls: 5, outputTokens: 400, costUsd: 0.1 } }, rate: { fiveHour: { utilization: 0.21 }, sevenDay: { utilization: 0.6 } } }));
  const text = await page.locator(".msg.stat").textContent();
  for (const re of [/12\.5 min/, /6/, /48 palabras/, /Llamadas a Claude11 · 2\.4 s/, /12\.000 entrada|12,000 entrada|12000 entrada/, /≈ \$0\.37/, /no se cobra/, /21%/, /60%/, /coach/])
    assert.match(text, re);
  assert.match(await page.locator("#rate").textContent(), /5 h: 21%/);
});

test("panel de entrenamiento: KPIs, límites de Claude, consumo por bot, memoria y sesiones", async () => {
  const page = await browser.newPage();
  await page.addInitScript(MOCKS);
  await page.addInitScript(() => {
    window.__dash = {
      agg: { sessions: 3, practiceSessions: 2, questions: 14, answered: 12, minutes: 41, calls: 30, inputTokens: 50000, outputTokens: 4200, costUsd: 1.234, avgAnswerWords: 52,
        byBot: { coach: { calls: 12, outputTokens: 1500, costUsd: 0.4 }, entrevistador: { calls: 12, outputTokens: 900, costUsd: 0.3 }, resumen: { calls: 3, outputTokens: 700, costUsd: 0.2 } } },
      memory: "### 2026-11-20\nBuen uso de STAR\nHueco: Kubernetes",
      rate: { fiveHour: { utilization: 0.85, resetsAt: 1795194600 }, sevenDay: { utilization: 0.4, resetsAt: 1795287600 } },
      history: [{ id: "a", date: "2026-11-20T10:00:00Z", mode: "simulacro", label: "DevOps", questions: 5, minutes: 12, summary: "**Sesión:** DevOps" }],
    };
  });
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(pathToFileURL(path.join(root, "dist/renderer", "dashboard.html")).href);
  await page.waitForSelector(".kpi");
  assert.equal(await page.locator(".kpi").count(), 7);
  const kpis = await page.locator("#kpis").textContent();
  assert.match(kpis, /Sesiones/); assert.match(kpis, /≈ \$1\.23/); assert.match(kpis, /52 palabras/);
  assert.match(await page.locator("#rate").textContent(), /85% usado/);
  assert.match(await page.locator("#rate").textContent(), /40% usado/);
  assert.ok(await page.locator("#rate .fill.hot").count() === 1, "≥80% se marca en alerta");
  assert.equal(await page.locator(".botrow").count(), 3);
  assert.match(await page.locator("#bots").textContent(), /Coach[\s\S]*12 llamadas/);
  assert.match(await page.locator("#agent").textContent(), /Entrenado con 3 sesiones/);
  assert.match(await page.locator("#agent pre").textContent(), /Hueco: Kubernetes/);
  assert.match(await page.locator("details.sess summary").textContent(), /simulacro · DevOps · 5 preguntas/);
  assert.deepEqual(errors, []);
});

test("cabecera: el botón 📊 Panel abre el panel", async () => {
  const page = await open("overlay.html");
  await page.click("#dash");
  assert.equal((await calls(page, "openDashboard")).length, 1);
});

test("ajustes: sin API key de Anthropic y con Supabase opcional", async () => {
  const page = await open("settings.html", { supabaseUrl: "https://x.supabase.co" });
  assert.equal(await page.locator("#anthropicKey").count(), 0);
  await page.waitForFunction(() => document.getElementById("supabaseUrl").value.includes("supabase.co"));
  await page.fill("#supabaseKey", "SECRETO");
  await page.click("#save");
  const saved = (await calls(page, "saveSettings"))[0][1];
  assert.equal(saved.supabaseKey, "SECRETO");
});

test("forma de la maqueta: cabecera en dos filas con los botones en la segunda", async () => {
  const page = await open("overlay.html");
  const rows = await page.evaluate(() => [...document.querySelectorAll("header .hrow")].map((r) => [...r.children].map((c) => c.id || c.tagName)));
  assert.equal(rows.length, 2);
  assert.ok(rows[0].includes("dot") && rows[0].includes("status") && rows[0].includes("rate"));
  assert.deepEqual(rows[1], ["dash", "practice", "listen", "gear"]);
  const y = await page.evaluate(() => ["status", "dash"].map((id) => document.getElementById(id).getBoundingClientRect().top));
  assert.ok(y[1] > y[0], "los botones quedan debajo del título");
});

test("las respuestas de Claude se ven con viñetas, negritas y la línea ❓ destacada", async () => {
  const page = await open("overlay.html");
  const text = "• Usa **CRD + reconciliation loop** (idempotente)\n• Cuida el **leader election**\n❓ ¿Has tocado algo parecido en tus proyectos?";
  await page.evaluate((t) => { __emit("answer-start", "q"); for (const c of t.match(/.{1,5}/gs)) __emit("answer-delta", c); __emit("answer-end"); }, text);
  assert.equal(await page.locator(".msg.ai li").count(), 2);
  assert.deepEqual(await page.locator(".msg.ai strong").allTextContents(), ["CRD + reconciliation loop", "leader election"]);
  assert.match(await page.locator(".msg.ai .ask").textContent(), /^❓ ¿Has tocado algo parecido/);
  const body = await page.locator(".msg.ai .body").textContent();
  assert.doesNotMatch(body, /\*\*|•/, "no deben verse los símbolos de formato");
  const color = await page.locator(".msg.ai .ask").evaluate((e) => getComputedStyle(e).color);
  assert.equal(color, "rgb(255, 180, 59)");
});

test("el formato no permite inyectar HTML desde el texto de la IA", async () => {
  const page = await open("overlay.html");
  await page.evaluate(() => {
    window.__pwned = false;
    __emit("answer-start", "q");
    __emit("answer-delta", "• <img src=x onerror=\"window.__pwned=true\"> y **<b>negrita</b>**\n<script>window.__pwned=true</script>");
    __emit("answer-end");
  });
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.__pwned), false);
  assert.equal(await page.locator(".msg.ai img, .msg.ai script, .msg.ai b").count(), 0);
  assert.match(await page.locator(".msg.ai .body").textContent(), /<img src=x/);
});

test("el feedback y el resumen también usan el formato; el feedback hablado no lleva símbolos", async () => {
  const page = await open("overlay.html");
  await page.evaluate(() => {
    window.__spoken = [];
    window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { cancel() {}, speak(u) { window.__spoken.push(u.text); } } });
    __emit("fb-start"); __emit("fb-delta", "✅ Buena estructura\n⚠️ Falta el **resultado medible**\n💡 Dilo con cifras"); __emit("fb-end");
    __emit("session-summary", "**Fortalezas:** claridad\n**Huecos:** Kubernetes", "/x.md");
  });
  assert.equal(await page.locator(".msg.fb .body > div").count(), 3);
  assert.deepEqual(await page.locator(".msg.fb strong").allTextContents(), ["resultado medible"]);
  assert.deepEqual(await page.locator(".msg.sum strong").allTextContents(), ["Fortalezas:", "Huecos:"]);
  const said = (await page.evaluate(() => window.__spoken))[0];
  assert.equal(said, "Buena estructura Falta el resultado medible Dilo con cifras", "sin emojis ni asteriscos");
});
