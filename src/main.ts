import { app, BrowserWindow, desktopCapturer, globalShortcut, ipcMain, screen, session } from "electron";
import path from "node:path";
import { importGithub } from "./github";
import { streamAnswer, Turn } from "./llm";
import { SttChannel } from "./stt";
import { loadSettings, saveSettings } from "./store";
import { Settings, Speaker } from "./types";

let overlay: BrowserWindow | null = null;
let settingsWin: BrowserWindow | null = null;
let settings: Settings;
let clickThrough = false;

const channels: Partial<Record<Speaker, SttChannel>> = {};
const history: Turn[] = [];
let pending = ""; // texto del entrevistador aún sin responder
let answerTimer: NodeJS.Timeout | null = null;
let abort: AbortController | null = null;

const send = (ch: string, ...args: unknown[]) => overlay?.webContents.send(ch, ...args);

function createOverlay(): void {
  const { workArea } = screen.getPrimaryDisplay();
  overlay = new BrowserWindow({
    width: 440,
    height: 600,
    x: workArea.x + workArea.width - 440 - 20,
    y: workArea.y + 20,
    title: "Interviewer Max",
    backgroundColor: "#14141b",
    autoHideMenuBar: true,
    alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true },
  });
  overlay.setAlwaysOnTop(true, "screen-saver");
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlay.loadFile(path.join(__dirname, "renderer", "overlay.html"));
}

function openSettings(): void {
  if (settingsWin && !settingsWin.isDestroyed()) return settingsWin.focus();
  settingsWin = new BrowserWindow({
    width: 640,
    height: 760,
    title: "Interviewer Max — Ajustes",
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true },
  });
  settingsWin.loadFile(path.join(__dirname, "renderer", "settings.html"));
}

function setClickThrough(on: boolean): void {
  clickThrough = on;
  overlay?.setIgnoreMouseEvents(on, { forward: true });
  send("click-through", on);
}

// ---------- Flujo: transcripción -> pregunta -> respuesta ----------

async function answer(question: string): Promise<void> {
  abort?.abort();
  abort = new AbortController();
  const ac = abort;
  send("answer-start", question);
  let full = "";
  try {
    await streamAnswer(settings, history, question, (d) => {
      full += d;
      send("answer-delta", d);
    }, ac.signal);
    history.push({ speaker: "them", text: question });
    send("answer-end");
  } catch (e: any) {
    if (!ac.signal.aborted) send("error", e?.message ?? String(e));
  }
}

function onTranscript(e: { speaker: Speaker; text: string; final: boolean; speechFinal: boolean }): void {
  send("transcript", e);
  if (e.speaker === "me") {
    if (e.final) history.push({ speaker: "me", text: e.text });
    return;
  }
  if (!e.final) return;
  pending = (pending + " " + e.text).trim();
  if (answerTimer) clearTimeout(answerTimer);
  // Espera a que el entrevistador termine de hablar antes de responder.
  answerTimer = setTimeout(() => {
    const q = pending;
    pending = "";
    if (q.split(/\s+/).length >= 4) void answer(q);
  }, e.speechFinal ? 700 : 1800);
}

function startListening(): void {
  stopListening();
  if (settings.stt === "local") return send("listening", true); // el renderer transcribe con Whisper
  if (!settings.deepgramKey) return send("error", "Falta la API key de Deepgram (Ajustes) o usa la transcripción local.");
  for (const sp of ["them", "me"] as Speaker[]) {
    const ch = new SttChannel(sp, settings, onTranscript, (m) => send("error", m));
    ch.start();
    channels[sp] = ch;
  }
  send("listening", true);
}

function stopListening(): void {
  for (const sp of ["them", "me"] as Speaker[]) {
    channels[sp]?.stop();
    delete channels[sp];
  }
  send("listening", false);
}

// ---------- IPC ----------

ipcMain.on("audio", (_e, speaker: Speaker, buf: ArrayBuffer) => channels[speaker]?.push(Buffer.from(buf)));
ipcMain.handle("settings:get", () => settings);
ipcMain.handle("settings:save", (_e, s: Settings) => {
  settings = s;
  saveSettings(s);
  return true;
});
ipcMain.handle("github:import", async (_e, user: string, token: string) => importGithub(user, token));
ipcMain.on("local-transcript", (_e, speaker: Speaker, text: string) =>
  onTranscript({ speaker, text, final: true, speechFinal: true }),
);
ipcMain.handle("stt-mode", () => settings.stt);
ipcMain.on("listen:start", startListening);
ipcMain.on("listen:stop", stopListening);
ipcMain.on("ask", (_e, q: string) => {
  const text = q.trim() || pending || [...history].reverse().find((t) => t.speaker === "them")?.text || "";
  if (text) void answer(text);
});
ipcMain.on("open-settings", openSettings);
ipcMain.on("quit", () => app.quit());
ipcMain.on("toggle-click-through", () => setClickThrough(!clickThrough));

// ---------- Arranque ----------

app.whenReady().then(() => {
  settings = loadSettings();

  // Permite capturar el audio del sistema (lo que dice el entrevistador) vía loopback.
  session.defaultSession.setDisplayMediaRequestHandler((_req, cb) => {
    desktopCapturer.getSources({ types: ["screen"] }).then((sources) => {
      cb({ video: sources[0], audio: "loopback" });
    });
  });

  createOverlay();
  if (!settings.profile && !settings.githubSummary) openSettings();

  globalShortcut.register("CommandOrControl+Shift+H", () => {
    if (!overlay) return;
    overlay.isVisible() ? overlay.hide() : overlay.show();
  });
  globalShortcut.register("CommandOrControl+Shift+C", () => setClickThrough(!clickThrough));
  globalShortcut.register("CommandOrControl+Shift+Space", () => {
    const q = pending || [...history].reverse().find((t) => t.speaker === "them")?.text;
    if (q) void answer(q);
  });
  globalShortcut.register("CommandOrControl+Shift+S", openSettings);
});

app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("window-all-closed", () => app.quit());
