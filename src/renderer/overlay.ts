declare const api: any;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const heard = $("heard");
const answerEl = $("answer");
const listenBtn = $<HTMLButtonElement>("listen");
const dot = $("dot");

let listening = false;
let streams: MediaStream[] = [];
let ctx: AudioContext | null = null;
let interim: Record<string, string> = { them: "", me: "" };

// ---------- Audio: sistema (entrevistador) + micro (yo) -> PCM16 16 kHz ----------

function pipe(stream: MediaStream, speaker: "them" | "me", audioCtx: AudioContext) {
  const src = audioCtx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
  const proc = audioCtx.createScriptProcessor(4096, 1, 1);
  const ratio = audioCtx.sampleRate / 16000;
  proc.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0);
    const outLen = Math.floor(input.length / ratio);
    const pcm = new Int16Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const s = Math.max(-1, Math.min(1, input[Math.floor(i * ratio)]));
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    api.sendAudio(speaker, pcm.buffer);
  };
  const mute = audioCtx.createGain();
  mute.gain.value = 0; // evita eco
  src.connect(proc);
  proc.connect(mute);
  mute.connect(audioCtx.destination);
}

async function startAudio() {
  ctx = new AudioContext();
  const sys = await (navigator.mediaDevices as any).getDisplayMedia({ video: true, audio: true });
  sys.getVideoTracks().forEach((t: MediaStreamTrack) => t.stop());
  const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  streams = [sys, mic];
  if (sys.getAudioTracks().length) pipe(sys, "them", ctx);
  else showError("No pude capturar el audio del sistema (¿Windows/Mac recientes?). Usa la caja de texto.");
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
    api.startListening();
    await startAudio();
  } catch (e: any) {
    showError(e?.message ?? String(e));
    api.stopListening();
    stopAudio();
  }
}

// ---------- UI ----------

function showError(msg: string) {
  answerEl.innerHTML = `<span class="err"></span>`;
  (answerEl.firstChild as HTMLElement).textContent = msg;
}

function renderHeard() {
  const parts: string[] = [];
  if (interim.them) parts.push("🎤 " + interim.them);
  if (interim.me) parts.push("🗣 " + interim.me);
  heard.textContent = parts.join("  ·  ");
}

listenBtn.onclick = toggle;
$("gear").onclick = () => api.openSettings();
$("quit").onclick = () => api.quit();
$("manual").addEventListener("keydown", (e) => {
  const el = e.target as HTMLInputElement;
  if (e.key === "Enter" && el.value.trim()) {
    api.ask(el.value);
    el.value = "";
  }
});

api.on("listening", (on: boolean) => {
  listening = on;
  listenBtn.textContent = on ? "■ Parar" : "▶ Escuchar";
  dot.className = on ? "on" : "";
});
api.on("transcript", (e: { speaker: "them" | "me"; text: string; final: boolean }) => {
  interim[e.speaker] = e.text;
  renderHeard();
  if (e.final) setTimeout(() => { if (interim[e.speaker] === e.text) { interim[e.speaker] = ""; renderHeard(); } }, 4000);
});
api.on("answer-start", (q: string) => {
  heard.textContent = "❓ " + q;
  answerEl.textContent = "";
  answerEl.classList.add("streaming");
});
api.on("answer-delta", (d: string) => {
  answerEl.textContent += d;
});
api.on("answer-end", () => answerEl.classList.remove("streaming"));
api.on("error", showError);
api.on("click-through", (on: boolean) => document.body.classList.toggle("ghost", on));
