// E2E con la app REAL de Electron (empaquetada) y un `claude` falso. Se omite si no hay binario.
// Uso: npm run dist:dir && xvfb-run -a node --test tests/electron.test.mjs   (en Linux sin pantalla)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const { _electron } = createRequire(import.meta.url)("playwright");
const root = path.resolve(import.meta.dirname, "..");
const exe = process.env.ELECTRON_APP || path.join(root, "release/linux-unpacked/interviewer-max");
const skip = !existsSync(exe) && "no hay app empaquetada (npm run dist:dir)";

let app, overlay, userData;

before(async () => {
  if (skip) return;
  const tmp = mkdtempSync(path.join(tmpdir(), "imax-e2e-"));
  userData = path.join(tmp, "data");
  const bin = path.join(tmp, "bin");
  mkdirSync(bin, { recursive: true });
  mkdirSync(userData, { recursive: true });
  // Perfil ya cargado para que no se abra la ventana de ajustes.
  writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ profile: "Soy ingeniero DevOps", language: "es", stt: "local", model: "m" }));
  writeFileSync(path.join(bin, "claude"), `#!/usr/bin/env node
let inp = "";
process.stdin.on("data", (d) => (inp += d)).on("end", () => {
  const out = (o) => console.log(JSON.stringify(o));
  out({ type: "rate_limit_event", rate_limit_info: { unifiedWindows: { five_hour: { utilization: 0.14, resetsAt: 1795194600 }, seven_day: { utilization: 0.56, resetsAt: 1795287600 } } } });
  const text = inp.includes("entrevistador profesional") ? "¿Cuéntame un proyecto de migración?"
    : inp.includes("Evalúa la respuesta") ? "✅ bien\\n⚠️ más datos\\n💡 así"
    : inp.includes("MEMORIA del coach") ? "**Sesión:** simulacro DevOps\\n**Huecos:** Kubernetes"
    : "• Un pod es la unidad mínima en Kubernetes";
  out({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text } } });
  out({ type: "result", subtype: "success", is_error: false, result: text, duration_ms: 300, total_cost_usd: 0.02, usage: { input_tokens: 5, cache_creation_input_tokens: 10, cache_read_input_tokens: 20, output_tokens: 9 } });
});
`);
  chmodSync(path.join(bin, "claude"), 0o755);
  app = await _electron.launch({
    executablePath: exe,
    args: ["--no-sandbox", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--user-data-dir=" + userData],
    env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH },
  });
  overlay = await app.firstWindow();
  await overlay.waitForSelector("#finish");
});
after(() => app?.close());

const history = () => JSON.parse(readFileSync(path.join(userData, "sessions/history.json"), "utf8"));

test("la app real arranca con la ventana de chat y el botón «✔ Acabado» abajo", { skip }, async () => {
  assert.equal(await overlay.title(), "Interviewer Max");
  assert.match(await overlay.locator("#finish").textContent(), /Acabado/);
  await overlay.click("#finish"); // sin nada que resumir
  await overlay.waitForTimeout(800);
  assert.equal(await overlay.locator(".msg.stat, .msg.sum").count(), 0, "sin sesión no hay resumen ni estadísticas");
  assert.equal(existsSync(path.join(userData, "sessions/history.json")), false);
});

test("pregunta manual → proceso principal → Claude (CLI) → respuesta en streaming en el chat", { skip }, async () => {
  await overlay.fill("#manual", "¿Qué es un pod?");
  await overlay.press("#manual", "Enter");
  await overlay.waitForSelector(".msg.ai .body");
  await overlay.waitForFunction(() => /unidad mínima en Kubernetes/.test(document.querySelector(".msg.ai .body").textContent), null, { timeout: 15000 });
  await overlay.waitForFunction(() => /5 h: 14% · semana: 56%/.test(document.getElementById("rate").textContent));
});

test("«✔ Acabado» resume, aprende y muestra estadísticas; todo queda en el historial", { skip }, async () => {
  await overlay.click("#finish");
  await overlay.waitForSelector(".msg.stat", { timeout: 20000 });
  const stats = await overlay.locator(".msg.stat").textContent();
  assert.match(stats, /Llamadas a Claude2/); // copiloto + resumen
  assert.match(stats, /no se cobra con tu suscripción/);
  assert.match(stats, /14%/);
  assert.match(await overlay.locator(".msg.sum").textContent(), /simulacro DevOps/);
  assert.equal(history().length, 1);
  assert.match(JSON.parse(readFileSync(path.join(userData, "settings.json"), "utf8")).memory, /Huecos:\*\* Kubernetes/);
});

test("simulacro completo: el bot pregunta, respondes, feedback, y al terminar salen estadísticas", { skip }, async () => {
  try {
    await overlay.click("#practice");
    await overlay.selectOption("#pjob", "devops");
    await overlay.click("#pgo");
    await overlay.waitForSelector(".msg.bot .body");
    await overlay.waitForFunction(() => /migración/.test(document.querySelector(".msg.bot .body").textContent), null, { timeout: 15000 });
    await overlay.waitForSelector(".msg.bot:not(.streaming)"); // el bot ya espera tu respuesta
    await overlay.fill("#manual", "Migré 40 servicios a Kubernetes");
    await overlay.press("#manual", "Enter");
    await overlay.waitForSelector(".msg.fb .body", { timeout: 15000 });
    await overlay.waitForFunction(() => /✅ bien/.test(document.querySelector(".msg.fb .body").textContent));
    await overlay.waitForSelector(".msg.fb:not(.streaming)"); // el intercambio se registra al terminar el feedback
    await overlay.click("#pend");
    try {
      await overlay.waitForFunction(() => document.querySelectorAll(".msg.stat").length === 2, null, { timeout: 25000 });
    } catch (e) {
      throw new Error("Chat al fallar:\n" + (await overlay.locator("#log").innerText()) + "\nEstado: " + (await overlay.locator("#status").innerText()));
    }
    const h = history();
    assert.equal(h.length, 2);
    assert.equal(h[1].mode, "simulacro");
    assert.match(h[1].label, /DevOps/);
    assert.equal(h[1].entries[0].answer, "Migré 40 servicios a Kubernetes");
    assert.match(h[1].entries[0].feedback, /✅ bien/);
    assert.ok(h[1].byBot.coach && h[1].byBot.entrevistador && h[1].byBot.resumen, "consumo por bot");
  } catch (e) {
    throw new Error(e.message + "\n--- Chat ---\n" + (await overlay.locator("#log").innerText()) + "\n--- Estado: " + (await overlay.locator("#status").innerText()));
  }
});

test("panel de entrenamiento (ventana real) con las 2 sesiones", { skip }, async () => {
  const [dash] = await Promise.all([app.waitForEvent("window"), overlay.click("#dash")]);
  await dash.waitForSelector(".kpi");
  assert.match(await dash.locator("#kpis").textContent(), /2Sesiones/);
  assert.match(await dash.locator("#agent").textContent(), /Entrenado con 2 sesiones/);
  assert.match(await dash.locator("#agent pre").textContent(), /Kubernetes/);
  assert.equal(await dash.locator("details.sess").count(), 2);
  assert.match(await dash.locator("#rate").textContent(), /14% usado/);
});

test("la ventana real nace arriba a la derecha (440×600) y recuerda dónde la dejas", { skip }, async () => {
  const info = await app.evaluate(({ BrowserWindow, screen }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.getTitle() === "Interviewer Max");
    return { b: w.getBounds(), work: screen.getPrimaryDisplay().workArea, min: w.getMinimumSize() };
  });
  assert.equal(info.b.width, 440);
  assert.equal(info.b.height, 600);
  assert.equal(info.b.x, info.work.x + info.work.width - 440 - 20, "pegada a la derecha con 20 px de margen");
  assert.equal(info.b.y, info.work.y + 20);
  assert.deepEqual(info.min, [360, 420]);

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x.getTitle() === "Interviewer Max").setBounds({ x: 120, y: 80, width: 500, height: 640 }));
  const file = path.join(userData, "window.json");
  for (let i = 0; i < 30 && !existsSync(file); i++) await new Promise((r) => setTimeout(r, 100));
  await new Promise((r) => setTimeout(r, 700)); // el guardado espera 0,5 s tras el último cambio
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { x: 120, y: 80, width: 500, height: 640 });
});
