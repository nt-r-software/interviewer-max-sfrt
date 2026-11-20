import { build } from "esbuild";
import { cpSync, mkdirSync } from "node:fs";

mkdirSync("dist/renderer", { recursive: true });
await build({
  entryPoints: ["src/renderer/overlay.ts", "src/renderer/settings.ts", "src/renderer/whisper-worker.ts", "src/renderer/dashboard.ts"],
  bundle: true,
  outdir: "dist/renderer",
  platform: "browser",
  target: "chrome130",
  format: "iife",
  define: { "process.env.NODE_ENV": "\"production\"" },
});
for (const f of ["overlay.html", "settings.html", "dashboard.html", "style.css"]) {
  cpSync(`src/renderer/${f}`, `dist/renderer/${f}`);
}
console.log("renderer built");
