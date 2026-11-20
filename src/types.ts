export interface Settings {
  anthropicKey: string;
  deepgramKey: string;
  githubUser: string;
  githubToken: string;
  model: string;
  profile: string; // CV, historias STAR, puntos fuertes (escrito por ti)
  githubSummary: string; // generado desde GitHub
  language: "auto" | "es" | "en";
}

export const DEFAULT_SETTINGS: Settings = {
  anthropicKey: "",
  deepgramKey: "",
  githubUser: "",
  githubToken: "",
  model: "claude-sonnet-5-5",
  profile: "",
  githubSummary: "",
  language: "auto",
};

export type Speaker = "them" | "me";

export interface TranscriptEvent {
  speaker: Speaker;
  text: string;
  final: boolean;
}
