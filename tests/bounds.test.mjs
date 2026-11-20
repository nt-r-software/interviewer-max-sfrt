// Posición y tamaño de la ventana: arriba a la derecha y se recuerda.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const { defaultBounds, clampBounds, loadBounds, saveBounds, MIN_SIZE } = createRequire(import.meta.url)(path.resolve(import.meta.dirname, "../dist/bounds.js"));
const hd = { x: 0, y: 0, width: 1920, height: 1032 };

test("por defecto: 440×600 arriba a la derecha con 20 px de margen (como la maqueta)", () => {
  assert.deepEqual(defaultBounds(hd), { x: 1460, y: 20, width: 440, height: 600 });
});

test("en pantallas pequeñas no se sale del área de trabajo", () => {
  const small = { x: 0, y: 0, width: 400, height: 500 };
  const b = defaultBounds(small);
  assert.ok(b.width <= 400 && b.height <= 500);
});

test("sin nada guardado o con datos corruptos usa la posición por defecto", () => {
  assert.deepEqual(clampBounds(null, [hd], hd), defaultBounds(hd));
  assert.deepEqual(clampBounds({ x: "a", y: 1, width: 2, height: 3 }, [hd], hd), defaultBounds(hd));
  assert.deepEqual(clampBounds({ x: NaN, y: 1, width: 400, height: 500 }, [hd], hd), defaultBounds(hd));
});

test("respeta lo guardado si es visible y aplica el tamaño mínimo", () => {
  assert.deepEqual(clampBounds({ x: 300, y: 100, width: 500, height: 700 }, [hd], hd), { x: 300, y: 100, width: 500, height: 700 });
  const tiny = clampBounds({ x: 300, y: 100, width: 50, height: 50 }, [hd], hd);
  assert.deepEqual([tiny.width, tiny.height], [MIN_SIZE.width, MIN_SIZE.height]);
});

test("si quedó en un monitor que ya no está conectado, vuelve a la posición por defecto", () => {
  assert.deepEqual(clampBounds({ x: 3000, y: 100, width: 440, height: 600 }, [hd], hd), defaultBounds(hd));
  // pero con un segundo monitor a la derecha sí se respeta
  const second = { x: 1920, y: 0, width: 1920, height: 1032 };
  assert.equal(clampBounds({ x: 3000, y: 100, width: 440, height: 600 }, [hd, second], hd).x, 3000);
});

test("guardar y cargar la posición", () => {
  const f = path.join(mkdtempSync(path.join(tmpdir(), "bnd-")), "sub", "window.json");
  assert.equal(loadBounds(f), null);
  saveBounds(f, { x: 10, y: 20, width: 440, height: 600 });
  assert.deepEqual(loadBounds(f), { x: 10, y: 20, width: 440, height: 600 });
  writeFileSync(f, "{roto");
  assert.equal(loadBounds(f), null);
});
