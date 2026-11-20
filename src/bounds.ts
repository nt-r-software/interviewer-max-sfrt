// Posición y tamaño de la ventana: arriba a la derecha por defecto y se recuerda entre arranques.
// Sin dependencias de Electron para poder probarlo.
import fs from "node:fs";
import path from "node:path";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const DEFAULT_SIZE = { width: 440, height: 600 };
export const MIN_SIZE = { width: 360, height: 420 };
const MARGIN = 20;

/** Esquina superior derecha del área de trabajo, como en la maqueta. */
export function defaultBounds(work: Rect): Rect {
  const width = Math.min(DEFAULT_SIZE.width, work.width);
  const height = Math.min(DEFAULT_SIZE.height, work.height);
  return { x: work.x + work.width - width - MARGIN, y: work.y + MARGIN, width, height };
}

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Usa lo guardado si sigue siendo válido y visible (p. ej. no queda en un monitor desconectado). */
export function clampBounds(saved: Partial<Rect> | null, displays: Rect[], primary: Rect): Rect {
  if (!saved || ![saved.x, saved.y, saved.width, saved.height].every(num)) return defaultBounds(primary);
  const r: Rect = {
    x: Math.round(saved.x!),
    y: Math.round(saved.y!),
    width: Math.max(MIN_SIZE.width, Math.round(saved.width!)),
    height: Math.max(MIN_SIZE.height, Math.round(saved.height!)),
  };
  const visible = displays.some((d) => overlap(r, d) >= 120 * 60);
  return visible ? r : defaultBounds(primary);
}

export function loadBounds(file: string): Partial<Rect> | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function saveBounds(file: string, r: Rect): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(r));
}
