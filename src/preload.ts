import { contextBridge, ipcRenderer } from "electron";

const on = (ch: string, cb: (...a: any[]) => void) => {
  ipcRenderer.on(ch, (_e, ...args) => cb(...args));
};

contextBridge.exposeInMainWorld("api", {
  sendAudio: (speaker: "them" | "me", buf: ArrayBuffer) => ipcRenderer.send("audio", speaker, buf),
  localTranscript: (speaker: "them" | "me", text: string) => ipcRenderer.send("local-transcript", speaker, text),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (s: unknown) => ipcRenderer.invoke("settings:save", s),
  importGithub: (user: string, token: string) => ipcRenderer.invoke("github:import", user, token),
  startListening: () => ipcRenderer.send("listen:start"),
  stopListening: () => ipcRenderer.send("listen:stop"),
  practiceStart: (opts: unknown) => ipcRenderer.send("practice:start", opts),
  practiceStop: () => ipcRenderer.send("practice:stop"),
  practiceDone: () => ipcRenderer.send("practice:done"),
  practiceSkip: () => ipcRenderer.send("practice:skip"),
  endSession: () => ipcRenderer.send("session:end"),
  ask: (q: string) => ipcRenderer.send("ask", q),
  openSettings: () => ipcRenderer.send("open-settings"),
  toggleClickThrough: () => ipcRenderer.send("toggle-click-through"),
  quit: () => ipcRenderer.send("quit"),
  on,
});
