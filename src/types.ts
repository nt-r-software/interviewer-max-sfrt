export interface Settings {
  anthropicKey: string;
  deepgramKey: string;
  githubUser: string;
  githubToken: string;
  model: string;
  profile: string; // CV, historias STAR, puntos fuertes (escrito por ti)
  githubSummary: string; // generado desde GitHub
  jobContext: string; // puesto / oferta a la que aplicas (opcional)
  language: "auto" | "es" | "en";
  stt: "local" | "deepgram"; // local = Whisper en tu PC, sin clave
}

export const DEFAULT_SETTINGS: Settings = {
  anthropicKey: "",
  deepgramKey: "",
  githubUser: "",
  githubToken: "",
  model: "claude-sonnet-5-5",
  profile: "",
  githubSummary: "",
  jobContext: "",
  language: "auto",
  stt: "local",
};

export type Speaker = "them" | "me";

export interface TranscriptEvent {
  speaker: Speaker;
  text: string;
  final: boolean;
}
