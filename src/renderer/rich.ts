// Formato ligero para las burbujas de Claude: viñetas, **negrita** y la línea ❓.
// Se construye con nodos DOM (nunca con innerHTML), así el texto de la IA no puede inyectar HTML.

const BULLET = /^\s*(?:[•\-*·])\s+(.*)$/;

function inline(parent: HTMLElement, text: string): void {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  for (const p of parts) {
    if (!p) continue;
    if (p.startsWith("**") && p.endsWith("**") && p.length > 4) {
      const b = document.createElement("strong");
      b.textContent = p.slice(2, -2);
      parent.append(b);
    } else parent.append(document.createTextNode(p));
  }
}

export function renderRich(el: HTMLElement, raw: string): void {
  el.replaceChildren();
  let list: HTMLUListElement | null = null;
  for (const line of raw.split("\n")) {
    if (!line.trim()) {
      list = null;
      continue;
    }
    const m = BULLET.exec(line);
    if (m) {
      if (!list) {
        list = document.createElement("ul");
        el.append(list);
      }
      const li = document.createElement("li");
      inline(li, m[1]);
      list.append(li);
      continue;
    }
    list = null;
    const div = document.createElement("div");
    if (line.trim().startsWith("❓")) div.className = "ask";
    inline(div, line.trim());
    el.append(div);
  }
}

/** Texto crudo acumulado de una burbuja que se va rellenando en streaming. */
export function appendRich(el: HTMLElement, delta: string): void {
  const raw = (el.dataset.raw ?? "") + delta;
  el.dataset.raw = raw;
  renderRich(el, raw);
}

export function setRich(el: HTMLElement, raw: string): void {
  el.dataset.raw = raw;
  renderRich(el, raw);
}
