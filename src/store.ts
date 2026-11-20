import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_SETTINGS, Settings } from "./types";

const SECRET_KEYS: (keyof Settings)[] = ["deepgramKey", "githubToken", "supabaseKey"];

function file(): string {
  return path.join(app.getPath("userData"), "settings.json");
}

function enc(v: string): string {
  if (!v) return "";
  if (safeStorage.isEncryptionAvailable()) return "enc:" + safeStorage.encryptString(v).toString("base64");
  return "raw:" + v;
}

function dec(v: string): string {
  if (!v) return "";
  if (v.startsWith("enc:")) return safeStorage.decryptString(Buffer.from(v.slice(4), "base64"));
  if (v.startsWith("raw:")) return v.slice(4);
  return v;
}

export function loadSettings(): Settings {
  try {
    const raw = JSON.parse(fs.readFileSync(file(), "utf8"));
    const s: Settings = { ...DEFAULT_SETTINGS, ...raw };
    for (const k of SECRET_KEYS) (s as any)[k] = dec((s as any)[k]);
    return s;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  const out: any = { ...s };
  for (const k of SECRET_KEYS) out[k] = enc(out[k]);
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(out, null, 2));
}
