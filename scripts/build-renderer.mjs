import { build } from "esbuild";
import { cpSync, mkdirSync } from "node:fs";

mkdirSync("dist/renderer", { recursive: true });
await build({
  entryPoints: ["src/renderer/overlay.ts", "src/renderer/settings.ts"],
  bundle: true,
  outdir: "dist/renderer",
  platform: "browser",
  target: "chrome130",
  format: "iife",
});
for (const f of ["overlay.html", "settings.html", "style.css"]) {
  cpSync(`src/renderer/${f}`, `dist/renderer/${f}`);
}
console.log("renderer built");
