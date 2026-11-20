declare const api: any;

const ids = ["anthropicKey", "deepgramKey", "model", "language", "stt", "githubUser", "githubToken", "githubSummary", "profile"];
const el = (id: string) => document.getElementById(id) as HTMLInputElement;

(async () => {
  const s = await api.getSettings();
  for (const id of ids) el(id).value = s[id] ?? "";
})();

el("save").onclick = async () => {
  const s = await api.getSettings();
  for (const id of ids) s[id] = el(id).value;
  await api.saveSettings(s);
  el("saved").textContent = "Guardado ✓";
  setTimeout(() => (el("saved").textContent = ""), 2000);
};

el("import").onclick = async () => {
  const status = el("importStatus");
  status.textContent = "Importando…";
  try {
    el("githubSummary").value = await api.importGithub(el("githubUser").value.trim(), el("githubToken").value.trim());
    status.textContent = "Listo ✓ (pulsa Guardar)";
  } catch (e: any) {
    status.textContent = "Error: " + (e?.message ?? e);
  }
};
