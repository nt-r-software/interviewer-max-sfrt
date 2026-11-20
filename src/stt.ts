import WebSocket from "ws";
import { Settings, Speaker, TranscriptEvent } from "./types";

// Un socket de Deepgram por fuente de audio (entrevistador = audio del sistema, yo = micrófono).
export class SttChannel {
  private ws: WebSocket | null = null;
  private keepAlive: NodeJS.Timeout | null = null;
  private queue: Buffer[] = [];

  constructor(
    private speaker: Speaker,
    private settings: Settings,
    private onEvent: (e: TranscriptEvent & { speechFinal: boolean }) => void,
    private onError: (msg: string) => void,
  ) {}

  start(): void {
    const lang = this.settings.language === "auto" ? "multi" : this.settings.language;
    const url =
      "wss://api.deepgram.com/v1/listen?" +
      new URLSearchParams({
        encoding: "linear16",
        sample_rate: "16000",
        channels: "1",
        model: "nova-3",
        language: lang,
        interim_results: "true",
        endpointing: "800",
        smart_format: "true",
      });
    const ws = new WebSocket(url, { headers: { Authorization: `Token ${this.settings.deepgramKey}` } });
    this.ws = ws;

    ws.on("open", () => {
      for (const b of this.queue) ws.send(b);
      this.queue = [];
      this.keepAlive = setInterval(() => ws.readyState === ws.OPEN && ws.send(JSON.stringify({ type: "KeepAlive" })), 8000);
    });
    ws.on("message", (data) => {
      try {
        const m = JSON.parse(data.toString());
        const text: string | undefined = m?.channel?.alternatives?.[0]?.transcript;
        if (m.type === "Results" && text) {
          this.onEvent({ speaker: this.speaker, text, final: !!m.is_final, speechFinal: !!m.speech_final });
        }
      } catch {
        /* ignorar */
      }
    });
    ws.on("error", (e) => this.onError(`Transcripción (${this.speaker}): ${e.message}`));
    ws.on("close", () => this.keepAlive && clearInterval(this.keepAlive));
  }

  push(pcm: Buffer): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(pcm);
    else if (this.queue.length < 100) this.queue.push(pcm);
  }

  stop(): void {
    if (this.keepAlive) clearInterval(this.keepAlive);
    try {
      this.ws?.send(JSON.stringify({ type: "CloseStream" }));
      this.ws?.close();
    } catch {
      /* ya cerrado */
    }
    this.ws = null;
  }
}
