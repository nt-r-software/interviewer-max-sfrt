import { JOBS, KINDS, LEVELS } from "../jobs";
declare const api: any;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const log = $("log");
const statusEl = $("status");
const listenBtn = $<HTMLButtonElement>("listen");
const dot = $("dot");

let listening = false;
let useLocal = true;
let language = "auto";
let streams: MediaStream[] = [];
let ctx: AudioContext | null = null;
let worker: Worker | null = null;
let ready = false;
let speaking = false; // el bot está hablando: no captamos audio para no oírlo a él mismo
let practicing = false;
let queued = 0; // frases pendientes de la voz del bot

// ---------- Chat ----------

type Kind = "them" | "me" | "ai" | "bot" | "fb" | "sum" | "err";
let current: HTMLElement | null = null; // burbuja de IA en curso
const last: Record<string, { el: HTMLElement; t: number } | undefined> = {};

function bubble(kind: Kind, text: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "msg " + kind;
  const label = document.createElement("div");
  label.className = "who";
  label.textContent = { them: "Entrevistador", me: "Tú", ai: "💭 Claude", bot: "🤖 Bot entrevistador", fb: "📝 Feedback", sum: "📚 Resumen de la sesión", err: "Aviso" }[kind];
  const body = document.createElement("div");
  body.className = "body";
  body.textContent = text;
  el.append(label, body);
  log.querySelector(".hint")?.remove();
  log.append(el);
  log.scrollTop = log.scrollHeight;
  return body;
}

function addSpeech(speaker: "them" | "me", text: string) {
  const prev = last[speaker];
  const now = Date.now();
  if (prev && now - prev.t < 3500 && prev.el.isConnected && log.lastElementChild === prev.el.parentElement) {
    prev.el.textContent += " " + text; // une fragmentos seguidos de la misma persona
    prev.t = now;
  } else {
    last[speaker] = { el: bubble(speaker, text), t: now };
  }
  log.scrollTop = log.scrollHeight;
}

const setStatus = (t: string) => (statusEl.textContent = t);

// ---------- Audio: sistema (entrevistador) + micro (yo) ----------

class Segmenter {
  private buf: Float32Array[] = [];
  private n = 0;
  private silence = 0;
  private speech = false;
  private prev: Float32Array | null = null;
  constructor(private onSeg: (a: Float32Array) => void) {}
  push(x: Float32Array) {
    let sum = 0;
    for (let i = 0; i < x.length; i++) sum += x[i] * x[i];
    const loud = Math.sqrt(sum / x.length) > 0.012;
    const dur = x.length / 16000;
    if (loud) {
      if (!this.speech && this.prev) { this.buf.push(this.prev); this.n += this.prev.length; }
      this.speech = true;
      this.silence = 0;
    } else if (this.speech) this.silence += dur;
    if (this.speech) { this.buf.push(x); this.n += x.length; }
    this.prev = x;
    if (this.speech && (this.silence >= 0.9 || this.n >= 16000 * 20)) this.flush();
  }
  flush() {
    if (this.n > 16000 * 0.6) {
      const out = new Float32Array(this.n);
      let o = 0;
      for (const b of this.buf) { out.set(b, o); o += b.length; }
      this.onSeg(out);
    }
    this.buf = []; this.n = 0; this.silence = 0; this.speech = false;
  }
}

function pipe(stream: MediaStream, speaker: "them" | "me", audioCtx: AudioContext) {
  const src = audioCtx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
  const proc = audioCtx.createScriptProcessor(4096, 1, 1);
  const ratio = audioCtx.sampleRate / 16000;
  const seg = new Segmenter((audio) => worker?.postMessage({ type: "asr", speaker, audio, language }, [audio.buffer]));
  proc.onaudioprocess = (e) => {
    if (speaking) return;
    const input = e.inputBuffer.getChannelData(0);
    const outLen = Math.floor(input.length / ratio);
    const f32 = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) f32[i] = input[Math.floor(i * ratio)];
    if (useLocal) {
      if (ready) seg.push(f32);
    } else {
      const pcm = new Int16Array(outLen);
      for (let i = 0; i < outLen; i++) {
        const s = Math.max(-1, Math.min(1, f32[i]));
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      api.sendAudio(speaker, pcm.buffer);
    }
  };
  const mute = audioCtx.createGain();
  mute.gain.value = 0;
  src.connect(proc);
  proc.connect(mute);
  mute.connect(audioCtx.destination);
}

const JUNK = /^[\s.\-–—…]*$|^\[.*\]$|^\(.*\)$|^(thanks for watching|gracias por ver)/i;

function startWorker() {
  if (worker) return;
  worker = new Worker("whisper-worker.js");
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === "status") setStatus(m.text);
    else if (m.type === "ready") { ready = true; setStatus("escuchando 🟢"); }
    else if (m.type === "error") bubble("err", m.text);
    else if (m.type === "result" && m.text && !JUNK.test(m.text)) {
      addSpeech(m.speaker, m.text);
      api.localTranscript(m.speaker, m.text);
    }
  };
  worker.postMessage({ type: "init" });
}

async function startAudio() {
  ctx = new AudioContext();
  const sys = await (navigator.mediaDevices as any).getDisplayMedia({ video: true, audio: true });
  sys.getVideoTracks().forEach((t: MediaStreamTrack) => t.stop());
  const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  streams = [sys, mic];
  if (sys.getAudioTracks().length) pipe(sys, "them", ctx);
  else bubble("err", "No pude capturar el audio del sistema. Puedes escribir la pregunta abajo.");
  pipe(mic, "me", ctx);
}

function stopAudio() {
  streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
  streams = [];
  ctx?.close();
  ctx = null;
}

async function toggle() {
  if (listening) {
    api.stopListening();
    stopAudio();
    return;
  }
  try {
    if (useLocal) startWorker();
    api.startListening();
    await startAudio();
    if (!useLocal) setStatus("escuchando 🟢");
  } catch (e: any) {
    bubble("err", e?.message ?? String(e));
    api.stopListening();
    stopAudio();
  }
}

// ---------- Eventos ----------

listenBtn.onclick = toggle;
$("gear").onclick = () => api.openSettings();
$("now").onclick = () => api.ask("");
$("manual").addEventListener("keydown", (e) => {
  const el = e.target as HTMLInputElement;
  if (e.key === "Enter" && el.value.trim()) {
    addSpeech(practicing ? "me" : "them", el.value.trim());
    api.ask(el.value);
    el.value = "";
  }
});

api.on("listening", (on: boolean) => {
  listening = on;
  listenBtn.textContent = on ? "■ Parar" : "▶ Escuchar";
  dot.className = on ? "on" : "";
  if (!on) setStatus("en pausa");
});
// Solo con Deepgram: transcripción que llega desde el proceso principal.
api.on("transcript", (e: { speaker: "them" | "me"; text: string; final: boolean }) => {
  if (!useLocal && e.final) addSpeech(e.speaker, e.text);
});
function startStream(kind: Kind) {
  current = bubble(kind, "…");
  current.parentElement!.classList.add("streaming");
  current.textContent = "";
}

function speak(text: string) {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const u = new SpeechSynthesisUtterance(text);
    const isEn = language === "en" || (language === "auto" && !/[¿¡áéíóúñ]|\b(el|la|los|de|que|tu|una?|con|para)\b/i.test(text));
    u.lang = isEn ? "en-US" : "es-ES";
    queued++;
    speaking = true;
    u.onend = u.onerror = () => setTimeout(() => { if (--queued <= 0) { queued = 0; speaking = false; } }, 600);
    synth.speak(u);
  } catch {
    speaking = false;
  }
}

const fill = (id: string, items: { id: string; label: string }[]) => {
  $<HTMLSelectElement>(id).innerHTML = items.map((i) => `<option value="${i.id}">${i.label}</option>`).join("");
};
fill("pjob", JOBS); fill("pkind", KINDS); fill("plevel", LEVELS);
$<HTMLSelectElement>("plevel").value = "medio";

$("practice").onclick = () => { $("picker").hidden = !$("picker").hidden; };
$("pcancel").onclick = () => { $("picker").hidden = true; };
$("pgo").onclick = async () => {
  if (practicing) return;
  $("picker").hidden = true;
  if (!listening) await toggle();
  api.practiceStart({
    job: $<HTMLSelectElement>("pjob").value,
    custom: $<HTMLInputElement>("pcustom").value,
    kind: $<HTMLSelectElement>("pkind").value,
    level: $<HTMLSelectElement>("plevel").value,
  });
};
$("pdone").onclick = () => api.practiceDone();
$("pskip").onclick = () => { try { speechSynthesis.cancel(); } catch {} speaking = false; queued = 0; api.practiceSkip(); };
$("pend").onclick = () => { try { speechSynthesis.cancel(); } catch {} speaking = false; queued = 0; api.practiceStop(); };

api.on("practice-state", (on: boolean) => {
  practicing = on;
  $("pbar").hidden = !on;
  $("practice").hidden = on;
  if (!on) { try { speechSynthesis.cancel(); } catch {} speaking = false; }
});
api.on("bot-start", () => { current?.parentElement?.remove(); startStream("bot"); });
api.on("bot-delta", (d: string) => { if (current) { current.textContent += d; log.scrollTop = log.scrollHeight; } });
api.on("bot-end", (q: string) => { current?.parentElement?.classList.remove("streaming"); current = null; speak(q); });
$("endsession").onclick = () => api.endSession();
api.on("session-status", setStatus);
api.on("session-summary", (text: string, file: string) => {
  setStatus(listening ? "escuchando 🟢" : "en pausa");
  const body = bubble("sum", text);
  const note = document.createElement("div");
  note.className = "muted";
  note.textContent = "Guardado en: " + file + " · ya está en la memoria de los bots.";
  const copy = document.createElement("button");
  copy.textContent = "Copiar resumen";
  copy.onclick = async () => {
    try { await navigator.clipboard.writeText(text); copy.textContent = "Copiado ✓"; } catch { copy.textContent = "Selecciona y copia a mano"; }
  };
  body.parentElement!.append(note, copy);
  log.scrollTop = log.scrollHeight;
});
api.on("fb-start", () => startStream("fb"));
api.on("fb-delta", (d: string) => { if (current) { current.textContent += d; log.scrollTop = log.scrollHeight; } });
api.on("fb-end", () => {
  const text = current?.textContent ?? "";
  current?.parentElement?.classList.remove("streaming");
  current = null;
  speak(text.replace(/[✅⚠️💡]/gu, "").replace(/\s+/g, " ").trim()); // el bot también te responde en voz
});

api.on("answer-start", () => {
  current = bubble("ai", "…");
  current.parentElement!.classList.add("streaming");
  current.textContent = "";
});
api.on("answer-delta", (d: string) => {
  if (current) { current.textContent += d; log.scrollTop = log.scrollHeight; }
});
api.on("answer-end", () => { current?.parentElement?.classList.remove("streaming"); current = null; });
api.on("error", (m: string) => { current?.parentElement?.remove(); current = null; bubble("err", m); });

(async () => {
  const s = await api.getSettings();
  useLocal = s.stt === "local";
  language = s.language;
  toggle(); // arranca directamente en modo escucha
})();
