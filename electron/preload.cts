import { contextBridge, ipcRenderer } from "electron";
import type { DesktopAPI, SessionEvent, Settings } from "./types.js";
const api: DesktopAPI = {
  settings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings: Settings) =>
    ipcRenderer.invoke("settings:save", settings),
  start: (sampleRate, consent) =>
    ipcRenderer.invoke("session:start", sampleRate, consent),
  audio: (frame) => ipcRenderer.send("session:audio", frame),
  pause: () => ipcRenderer.invoke("session:pause"),
  clear: () => ipcRenderer.invoke("session:clear"),
  onEvent: (listener) => {
    const handler = (_: unknown, event: SessionEvent) => listener(event);
    ipcRenderer.on("session:event", handler);
    return () => ipcRenderer.removeListener("session:event", handler);
  },
};
contextBridge.exposeInMainWorld("desktop", api);
