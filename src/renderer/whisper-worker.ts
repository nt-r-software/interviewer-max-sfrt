import { env, pipeline } from "@huggingface/transformers";

// Whisper corre en tu PC (WASM). Solo necesita internet la primera vez para bajar el modelo (~80 MB).
env.allowLocalModels = false;

let asr: any = null;
let loading: Promise<void> | null = null;

function load(): Promise<void> {
  if (!loading) {
    loading = (async () => {
      (self as any).postMessage({ type: "status", text: "Descargando modelo de voz (solo la 1ª vez)…" });
      asr = await pipeline("automatic-speech-recognition", "Xenova/whisper-base", {
        device: "wasm",
        dtype: "q8",
        progress_callback: (p: any) => {
          if (p.status === "progress" && typeof p.progress === "number")
            (self as any).postMessage({ type: "status", text: `Descargando modelo de voz… ${Math.round(p.progress)}%` });
        },
      } as any);
      (self as any).postMessage({ type: "ready" });
    })();
  }
  return loading;
}

self.onmessage = async (e: MessageEvent) => {
  const m = e.data;
  try {
    if (m.type === "init") return void (await load());
    await load();
    const language = m.language === "es" ? "spanish" : m.language === "en" ? "english" : undefined;
    const out = await asr(m.audio, { task: "transcribe", ...(language ? { language } : {}) });
    (self as any).postMessage({ type: "result", speaker: m.speaker, text: String(out.text ?? "").trim() });
  } catch (err: any) {
    (self as any).postMessage({ type: "error", text: "Whisper: " + (err?.message ?? String(err)) });
  }
};
