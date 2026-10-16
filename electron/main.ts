import {
  app,
  BrowserWindow,
  ipcMain,
  safeStorage,
  systemPreferences,
  session,
} from "electron";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { serviceError } from "./translation.js";
import { sonioxContext, SonioxTranscript, type SonioxResponse } from "./soniox.js";
import type { Settings, SettingsStatus, SessionEvent } from "./types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
let window: BrowserWindow;
let settings: Settings = { sonioxKey: "", role: "", terms: "" };
let socket: WebSocket | undefined;
let keepAlive: ReturnType<typeof setInterval> | undefined;
let heartbeat: ReturnType<typeof setInterval> | undefined;
let lastPong = 0;
let active = false;
let connectionGeneration = 0;

const emit = (event: SessionEvent) => {
  if (!window.isDestroyed()) window.webContents.send("session:event", event);
};
const settingsPath = () =>
  path.join(app.getPath("userData"), "credentials.enc");
const status = (): SettingsStatus => ({
  soniox: !!settings.sonioxKey,
  role: settings.role,
  terms: settings.terms,
  secureStorage: safeStorage.isEncryptionAvailable(),
});
function stopSocket() {
  connectionGeneration++;
  active = false;
  clearInterval(keepAlive);
  clearInterval(heartbeat);
  const old = socket;
  socket = undefined;
  old?.terminate();
}
function pause() {
  stopSocket();
  emit({ type: "interim", text: "" });
  emit({ type: "status", state: "paused" });
}
function fail(message: string) {
  stopSocket();
  emit({ type: "interim", text: "" });
  emit({ type: "status", state: "error", message });
}
async function start(sampleRate: number, consent: boolean) {
  if (consent !== true) throw new Error("请先确认对方同意收音及云端处理。");
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000)
    throw new Error("不支持的音频采样率。");
  if (!settings.sonioxKey)
    throw new Error("请先在设置中填写 Soniox API 密钥。");
  stopSocket();
  const generation = connectionGeneration;
  if (
    process.platform === "darwin" &&
    !(await systemPreferences.askForMediaAccess("microphone"))
  )
    throw new Error(
      "麦克风权限未开启。请在系统设置 → 隐私与安全性 → 麦克风中允许听译。",
    );
  if (generation !== connectionGeneration) throw new Error("连接已取消。");
  emit({ type: "status", state: "connecting" });
  const ws = new WebSocket("wss://stt-rt.soniox.com/transcribe-websocket", {
    headers: { Authorization: `Bearer ${settings.sonioxKey}` },
    handshakeTimeout: 10_000,
  });
  socket = ws;
  const tracker = new SonioxTranscript();
  const id = randomUUID();
  const timestamp = Date.now();
  return new Promise<void>((resolve, reject) => {
    let opened = false;
    ws.on("open", () => {
      if (socket !== ws) {
        ws.terminate();
        reject(new Error("连接已取消。"));
        return;
      }
      ws.send(JSON.stringify({
        model: "stt-rt-v5", audio_format: "s16le", sample_rate: sampleRate,
        num_channels: 1, language_hints: ["ko"],
        translation: { type: "one_way", target_language: "zh" },
        context: sonioxContext(settings.role, settings.terms),
      }));
      opened = true;
      active = true;
      lastPong = Date.now();
      keepAlive = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN)
          ws.send(JSON.stringify({ type: "keepalive" }));
      }, 4000);
      heartbeat = setInterval(() => {
        if (Date.now() - lastPong > 15_000) {
          fail("识别连接中断，请检查网络并点击继续。");
          return;
        }
        if (ws.readyState === WebSocket.OPEN) ws.ping();
      }, 5000);
      emit({ type: "status", state: "listening" });
      resolve();
    });
    ws.on("pong", () => {
      lastPong = Date.now();
    });
    ws.on("message", (data) => {
      if (!active || socket !== ws) return;
      let result: SonioxResponse;
      try { result = JSON.parse(data.toString()); } catch { return; }
      if (result.error_code) {
        fail(serviceError(result.error_code, "Soniox"));
        return;
      }
      if (!result.tokens?.length) return;
      const text = tracker.accept(result);
      emit({ type: "segment", id, original: text.original, timestamp, confidence: 1 });
      emit({ type: "translation", id, text: text.translation, latency: 0 });
    });
    ws.on("unexpected-response", (_request, response) => {
      const message = serviceError(response.statusCode ?? 500, "Soniox");
      response.resume();
      if (socket === ws) fail(message);
      reject(new Error(message));
    });
    ws.on("error", () => {
      const message = "无法连接语音识别服务，请检查网络和密钥后重试。";
      if (socket === ws) fail(message);
      if (!opened) reject(new Error(message));
    });
    ws.on("close", () => {
      if (!opened) reject(new Error("识别连接未建立，请重试。"));
      if (socket === ws)
        fail(
          "识别连接已断开。已确认字幕已保留，点击继续重新收音；断开期间的语音不会补录。",
        );
    });
  });
}

void app.whenReady().then(async () => {
  try {
    if (safeStorage.isEncryptionAvailable())
      settings = { sonioxKey: "", role: "", terms: "", ...JSON.parse(
        safeStorage.decryptString(await readFile(settingsPath())),
      ) };
  } catch {
    /* First launch, or credentials unavailable: require settings again. */
  }
  window = new BrowserWindow({
    width: 1240,
    height: 850,
    minWidth: 850,
    minHeight: 640,
    title: "听译 · Translate",
    backgroundColor: "#f6f7f9",
    webPreferences: {
      preload: path.join(here, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const trustedURL = app.isPackaged
    ? new URL(`file://${path.join(here, "../dist/index.html")}`).href
    : "http://127.0.0.1:5173/";
  function trustedFrame(url: string) {
    if (!app.isPackaged) return url.startsWith("http://127.0.0.1:5173/");
    try {
      const frame = new URL(url);
      frame.search = "";
      frame.hash = "";
      return frame.href === trustedURL;
    } catch { return false; }
  }
  session.defaultSession.setPermissionRequestHandler(
    (contents, permission, callback) =>
      callback(
        contents.id === window.webContents.id &&
          trustedFrame(contents.getURL()) &&
          permission === "media",
      ),
  );
  session.defaultSession.setPermissionCheckHandler(
    (contents, permission) =>
      !!contents &&
      contents.id === window.webContents.id &&
      trustedFrame(contents.getURL()) &&
      permission === "media",
  );
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (!trustedFrame(url)) event.preventDefault();
  });
  function handle(channel: string, callback: (...args: any[]) => unknown) {
    ipcMain.handle(channel, (event, ...args) => {
      if (
        event.sender.id !== window.webContents.id ||
        !trustedFrame(event.senderFrame?.url ?? "")
      )
        throw new Error("不允许的请求。");
      return callback(...args);
    });
  }
  handle("settings:get", status);
  handle("settings:save", async (input: Settings) => {
    if (active || socket) throw new Error("请先暂停收音再修改设置。");
    if (!safeStorage.isEncryptionAvailable())
      throw new Error("系统安全存储不可用，无法保存密钥。");
    if (
      !input ||
      typeof input.sonioxKey !== "string" ||
      typeof input.role !== "string" || typeof input.terms !== "string" ||
      input.role.length > 1000 || input.terms.length > 3000
    )
      throw new Error("设置格式无效。");
    const next = { sonioxKey: input.sonioxKey.trim() || settings.sonioxKey,
      role: input.role.trim(), terms: input.terms.trim() };
    await writeFile(
      settingsPath(),
      safeStorage.encryptString(JSON.stringify(next)),
      { mode: 0o600 },
    );
    settings = next;
    return status();
  });
  handle("session:start", start);
  handle("session:pause", pause);
  handle("session:clear", () => {
    pause();
  });

  ipcMain.on("session:audio", (event, frame: unknown) => {
    if (
      event.sender.id !== window.webContents.id ||
      !trustedFrame(event.senderFrame?.url ?? "")
    )
      return;
    if (
      !active ||
      socket?.readyState !== WebSocket.OPEN ||
      !(frame instanceof ArrayBuffer) ||
      frame.byteLength > 65536
    )
      return;
    if (socket.bufferedAmount > 256000) {
      fail("上传速度跟不上收音，已暂停以避免字幕持续延迟。请检查网络后继续。");
      return;
    }
    socket.send(Buffer.from(frame));
  });
  window.on("closed", () => {
    stopSocket();
  });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", stopSocket);
  if (app.isPackaged)
    await window.loadFile(path.join(here, "../dist/index.html"),
      process.argv.includes("--settings") ? { query: { settings: "1" } } : {});
  else await window.loadURL("http://127.0.0.1:5173/" + (process.argv.includes("--settings") ? "?settings=1" : ""));
});
