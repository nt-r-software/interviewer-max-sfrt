declare const api: any;

const el = (id: string) => document.getElementById(id)!;
function h(tag: string, cls = "", text = ""): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}
const fmt = (n: number) => n.toLocaleString("es-ES");
const BOTS: Record<string, string> = {
  copiloto: "💭 Copiloto",
  entrevistador: "🎤 Entrevistador",
  coach: "📝 Coach",
  resumen: "📚 Resumen",
  otro: "Otros",
};

function kpi(label: string, value: string, hint = ""): HTMLElement {
  const k = h("div", "kpi");
  k.append(h("div", "kv", value), h("div", "kl", label));
  if (hint) k.append(h("div", "kh", hint));
  return k;
}

function gauge(title: string, w?: { utilization: number; resetsAt: number }): HTMLElement {
  const box = h("div", "gauge");
  const pct = w ? Math.round(w.utilization * 100) : null;
  box.append(h("div", "gt", title));
  const bar = h("div", "bar");
  const fill = h("div", "fill" + (pct !== null && pct >= 80 ? " hot" : ""));
  fill.style.width = (pct ?? 0) + "%";
  bar.append(fill);
  box.append(bar, h("div", "gv", pct === null ? "Aún sin datos (se mide al usar Claude)" : pct + "% usado"));
  if (w?.resetsAt) box.append(h("div", "kh", "Se renueva: " + new Date(w.resetsAt * 1000).toLocaleString("es-ES")));
  return box;
}

(async () => {
  const { history, agg, memory, rate } = await api.getDashboard();

  el("kpis").append(
    kpi("Sesiones", fmt(agg.sessions), agg.practiceSessions + " de simulacro"),
    kpi("Preguntas", fmt(agg.questions), fmt(agg.answered) + " respondidas"),
    kpi("Tiempo", fmt(agg.minutes) + " min"),
    kpi("Respuesta media", agg.avgAnswerWords + " palabras"),
    kpi("Llamadas a Claude", fmt(agg.calls)),
    kpi("Tokens", fmt(agg.inputTokens + agg.outputTokens), fmt(agg.outputTokens) + " de salida"),
    kpi("Equivalente API", "≈ $" + agg.costUsd.toFixed(2), "no se cobra con tu suscripción"),
  );

  el("rate").append(gauge("Límite de 5 horas", rate.fiveHour), gauge("Límite semanal", rate.sevenDay));

  const bots = el("bots");
  const entries = Object.entries(agg.byBot) as [string, { calls: number; outputTokens: number; costUsd: number }][];
  if (!entries.length) bots.append(h("p", "muted", "Todavía no hay consumo registrado."));
  const max = Math.max(1, ...entries.map(([, v]) => v.calls));
  for (const [bot, v] of entries) {
    const row = h("div", "botrow");
    const bar = h("div", "bar");
    const fill = h("div", "fill");
    fill.style.width = (v.calls / max) * 100 + "%";
    bar.append(fill);
    row.append(h("span", "bn", BOTS[bot] ?? bot), bar, h("span", "bv", v.calls + " llamadas · " + fmt(v.outputTokens) + " tokens de salida"));
    bots.append(row);
  }

  const agent = el("agent");
  const facts = memory.split("\n").filter((l: string) => l.trim()).length;
  agent.append(h("p", "", "Entrenado con " + agg.sessions + " sesiones. Su memoria tiene " + facts + " líneas y alimenta a los cuatro bots en cada respuesta."));
  agent.append(h("pre", "memory", memory || "Aún vacía: se rellena sola al pulsar «✔ Acabado» después de una entrevista o un simulacro."));

  const list = el("sessions");
  if (!history.length) list.append(h("p", "muted", "Aún no hay sesiones guardadas."));
  for (const r of [...history].reverse()) {
    const d = h("details", "sess");
    const title = new Date(r.date).toLocaleString("es-ES") + " · " + r.mode + (r.label ? " · " + r.label : "") + " · " + r.questions + " preguntas · " + r.minutes + " min";
    d.append(h("summary", "", title), h("pre", "memory", r.summary || "(sin resumen)"));
    list.append(d);
  }
})();
