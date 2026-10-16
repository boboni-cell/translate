import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AudioLines,
  ArrowDown,
  ArrowRight,
  Check,
  ChevronDown,
  CircleHelp,
  Globe2,
  Headphones,
  Mic,
  Pause,
  Play,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Trash2,
  X,
  Volume2,
  Wifi,
  AlertCircle,
} from "lucide-react";
import type {
  DesktopAPI,
  SessionEvent,
  SettingsStatus,
} from "../electron/types";
import { Microphone, microphoneError } from "./audio";
import "./style.css";
declare global {
  interface Window {
    desktop?: DesktopAPI;
  }
}
type Segment = {
  id: string;
  original: string;
  timestamp: number;
  confidence: number;
  translation?: string;
  error?: string;
  latency?: number;
};
type State = "idle" | "connecting" | "listening" | "paused" | "error";
const labels: Record<State, string> = {
  idle: "准备就绪",
  connecting: "正在连接",
  listening: "正在聆听",
  paused: "已暂停",
  error: "连接异常",
};
function App() {
  const api = window.desktop;
  const [state, setState] = useState<State>("idle");
  const [settings, setSettings] = useState<SettingsStatus>();
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState("");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [device, setDevice] = useState("");
  const [level, setLevel] = useState(0);
  const [consent, setConsent] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [autoScroll, setAutoScroll] = useState(true);
  const [confirmClear, setConfirmClear] = useState(false);
  const microphone = useRef<Microphone | null>(null);
  const generation = useRef(0);
  const bottom = useRef<HTMLDivElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const receiving = useRef(false);
  const busy = state === "connecting" || state === "listening";
  const configured = settings?.deepgram && settings?.deepl;
  const refreshDevices = async () => {
    try {
      setDevices(
        (await navigator.mediaDevices.enumerateDevices()).filter(
          (d) => d.kind === "audioinput",
        ),
      );
    } catch {
      setError("无法读取麦克风列表，请检查设备权限。");
    }
  };
  useEffect(() => {
    void api
      ?.settings()
      .then(setSettings)
      .catch(() => setError("无法读取服务配置。"));
    void refreshDevices();
    const handler = () => void refreshDevices();
    navigator.mediaDevices?.addEventListener("devicechange", handler);
    const off = api?.onEvent((event: SessionEvent) => {
      if (event.type === "status") {
        setState(event.state);
        if (event.message) setError(event.message);
        if (event.state === "error") {
          receiving.current = false;
          generation.current++;
          microphone.current?.stop();
          microphone.current = null;
        }
      } else if (event.type === "interim") setInterim(event.text);
      else if (event.type === "segment")
        setSegments((items) => [...items, { ...event }]);
      else if (event.type === "translation")
        setSegments((items) =>
          items.map((item) =>
            item.id === event.id
              ? {
                  ...item,
                  translation: event.text,
                  error: undefined,
                  latency: event.latency,
                }
              : item,
          ),
        );
      else if (event.type === "translation-error")
        setSegments((items) =>
          items.map((item) =>
            item.id === event.id ? { ...item, error: event.message } : item,
          ),
        );
    });
    return () => {
      off?.();
      microphone.current?.stop();
      navigator.mediaDevices?.removeEventListener("devicechange", handler);
    };
  }, []);
  useEffect(() => {
    if (autoScroll && (segments.length || interim))
      bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [segments, interim, autoScroll]);
  useEffect(() => {
    if (state !== "listening") return;
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [state]);
  useEffect(() => {
    const offline = () => {
      if (microphone.current) {
        void pause();
        setError(
          "网络已断开，收音已暂停。恢复网络后点击继续；断开期间的语音不会补录。",
        );
      }
    };
    window.addEventListener("offline", offline);
    return () => window.removeEventListener("offline", offline);
  }, []);
  async function pause() {
    generation.current++;
    receiving.current = false;
    microphone.current?.stop();
    microphone.current = null;
    setState("paused");
    setInterim("");
    await api?.pause();
  }
  async function start() {
    if (!api) {
      setError("请在桌面应用中使用实时收音。");
      return;
    }
    if (!configured) {
      setShowSettings(true);
      return;
    }
    if (!consent) {
      setError("请先确认已获得对方同意。");
      return;
    }
    const current = ++generation.current;
    setState("connecting");
    setError("");
    const mic = new Microphone(
      (frame) => {
        if (receiving.current) api.audio(frame);
      },
      setLevel,
      () => {
        void pause();
        setError("麦克风已断开，请重新选择设备后继续。");
      },
    );
    microphone.current = mic;
    try {
      const rate = await mic.prepare(device);
      if (current !== generation.current) return;
      await refreshDevices();
      await api.start(rate, consent);
      if (current !== generation.current) {
        mic.stop();
        return;
      }
      receiving.current = true;
      await mic.resume();
    } catch (err) {
      mic.stop();
      if (current === generation.current) {
        receiving.current = false;
        await api.pause();
        setState("error");
        setError(microphoneError(err));
      }
    }
  }
  async function clear() {
    await pause();
    await api?.clear();
    setSegments([]);
    setSeconds(0);
    setError("");
    setAutoScroll(true);
    setConfirmClear(false);
  }
  const latency = segments
    .filter((s) => s.latency !== undefined)
    .slice(-1)[0]?.latency;
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">
            <AudioLines size={24} />
          </div>
          <span>
            听译<span className="brand-en">TRANSLATE</span>
          </span>
        </div>
        <div className="nav-section">工作空间</div>
        <div className="nav-item selected">
          <Headphones size={19} />
          <span>现场翻译</span>
          <span className="nav-dot" />
        </div>
        <div className="sidebar-note">
          <span className="tiny-label">专注当下的对话</span>
          <p>
            听懂每一句，
            <br />
            让交流自然发生。
          </p>
          <div className="language-pills">
            <span>한국어</span>
            <ArrowRight size={13} />
            <span>中文</span>
          </div>
        </div>
        <div className="sidebar-bottom">
          <button onClick={() => setShowSettings(true)}>
            <Settings2 size={17} />
            服务设置
          </button>
          <button onClick={() => setShowHelp(true)}>
            <CircleHelp size={17} />
            使用说明
          </button>
          <div className="version">
            <span className="version-dot" />
            本地桌面应用 <span>v0.1</span>
          </div>
        </div>
      </aside>
      <main>
        <header>
          <div className="breadcrumb">
            工作空间 <span>/</span> <strong>现场翻译</strong>
          </div>
          <div className="header-right">
            <span className="local-badge">
              <ShieldCheck size={14} />
              录音不落盘
            </span>
            <button
              className="icon-button"
              aria-label="打开设置"
              onClick={() => setShowSettings(true)}
            >
              <Settings2 size={18} />
            </button>
          </div>
        </header>
        <section className="workspace">
          <div className="page-title">
            <div>
              <div className="eyebrow">LIVE TRANSLATION</div>
              <h1>
                让语言，不再是距离<span>。</span>
              </h1>
              <p>专注交流，韩语原文与中文翻译会在这里同步呈现。</p>
            </div>
            <div className={`status-pill ${state}`}>
              <span />
              {labels[state]}
            </div>
          </div>
          {!api && (
            <div className="notice">
              <AlertCircle size={17} />
              当前为浏览器界面预览。实时翻译请运行桌面应用。
            </div>
          )}
          {error && (
            <div className="notice error" role="alert">
              <AlertCircle size={17} />
              <span>{error}</span>
              <button aria-label="关闭提示" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          <div className="session-toolbar">
            <div className="language-direction">
              <span className="flag">한</span>
              <strong>韩语</strong>
              <span className="language-code">KO</span>
              <ArrowRight size={15} />
              <span className="flag chinese">中</span>
              <strong>简体中文</strong>
              <span className="language-code">ZH</span>
            </div>
            <div className="session-tools">
              <span className="timer">
                {String(Math.floor(seconds / 60)).padStart(2, "0")}:
                {String(seconds % 60).padStart(2, "0")}
              </span>
              <span className="divider" />
              <button
                disabled={!segments.length && !interim}
                onClick={() => setConfirmClear(true)}
              >
                <Trash2 size={15} />
                清除字幕
              </button>
            </div>
          </div>
          <div className="transcript-card">
            <div className="column-head">
              <div>
                <span className="column-dot" />
                韩语原文 <span>KOREAN</span>
              </div>
              <div>
                <span className="column-dot blue" />
                中文翻译 <span>CHINESE</span>
              </div>
            </div>
            <div
              className="transcript-scroll"
              ref={scroll}
              onScroll={() => {
                const el = scroll.current;
                if (el)
                  setAutoScroll(
                    el.scrollHeight - el.scrollTop - el.clientHeight < 90,
                  );
              }}
            >
              {!segments.length && !interim ? (
                <div className="empty-state">
                  <div className="empty-illustration">
                    <div className="orbit orbit-one" />
                    <div className="orbit orbit-two" />
                    <div className="wave-icon">
                      <AudioLines size={40} strokeWidth={1.7} />
                    </div>
                    <span className="floating-mark">한</span>
                    <span className="floating-mark mark-two">中</span>
                  </div>
                  <h2>
                    {configured ? "准备好，开始一段对话" : "从听见，到听懂"}
                  </h2>
                  <p>
                    {configured
                      ? "点击下方「开始翻译」，说出的韩语将自动转为中文。"
                      : "连接语音与翻译服务，开启你的实时韩中翻译。"}
                  </p>
                  <div className="empty-features">
                    <span>
                      <Mic size={14} />
                      实时收音
                    </span>
                    <i />
                    <span>
                      <Globe2 size={14} />
                      双语字幕
                    </span>
                    <i />
                    <span>
                      <ShieldCheck size={14} />
                      不保存录音
                    </span>
                  </div>
                  {!configured && (
                    <button
                      className="setup-button"
                      onClick={() => setShowSettings(true)}
                    >
                      配置翻译服务
                      <ArrowRight size={15} />
                    </button>
                  )}
                </div>
              ) : (
                <>
                  {segments.map((segment, index) => (
                    <div className="transcript-row" key={segment.id}>
                      <div className="original">
                        <div className="segment-meta">
                          <span>{String(index + 1).padStart(2, "0")}</span>
                          <time>
                            {new Date(segment.timestamp).toLocaleTimeString(
                              "zh-CN",
                              { hour12: false },
                            )}
                          </time>
                          {segment.confidence < 0.8 && (
                            <span className="uncertain">识别待确认</span>
                          )}
                        </div>
                        <p lang="ko">{segment.original}</p>
                      </div>
                      <div className="translated">
                        {segment.translation ? (
                          <p>{segment.translation}</p>
                        ) : segment.error ? (
                          <div className="translation-error">
                            <span>{segment.error}</span>
                            <button
                              onClick={() => {
                                setSegments((items) =>
                                  items.map((s) =>
                                    s.id === segment.id
                                      ? { ...s, error: undefined }
                                      : s,
                                  ),
                                );
                                void api?.retry(segment.id);
                              }}
                            >
                              <RefreshCw size={12} />
                              重试翻译
                            </button>
                          </div>
                        ) : (
                          <div className="translating">
                            <span className="loading-dots">•••</span>正在翻译
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  {interim && (
                    <div className="transcript-row interim">
                      <div className="original">
                        <div className="segment-meta">
                          <span className="live-indicator" />
                          正在识别
                        </div>
                        <p lang="ko">
                          {interim}
                          <span className="cursor" />
                        </p>
                      </div>
                      <div className="translated">
                        <span className="interim-hint">语句稳定后自动翻译</span>
                      </div>
                    </div>
                  )}
                </>
              )}
              <div ref={bottom} />
            </div>
            <div className="transcript-footer">
              <span>
                <span
                  className={`small-dot ${state === "listening" ? "green" : ""}`}
                />
                {state === "listening"
                  ? "持续收音中 · 稳定片段自动翻译"
                  : "仅在开始后收音 · 字幕仅保留在本次窗口"}
              </span>
              <button
                onClick={() => {
                  setAutoScroll(true);
                  bottom.current?.scrollIntoView({ behavior: "smooth" });
                }}
                className={autoScroll ? "follow-active" : ""}
              >
                <ArrowDown size={13} />
                跟随最新
              </button>
            </div>
          </div>
          <div className="control-panel">
            <div className="device-control">
              <div className="mic-icon">
                <Mic size={20} />
              </div>
              <div>
                <label htmlFor="microphone">音频输入</label>
                <div className="device-select">
                  <select
                    id="microphone"
                    value={device}
                    disabled={busy}
                    onChange={(e) => setDevice(e.target.value)}
                  >
                    <option value="">系统默认麦克风</option>
                    {devices
                      .filter((d) => d.deviceId && d.deviceId !== "default")
                      .map((d, i) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label || `麦克风 ${i + 1}`}
                        </option>
                      ))}
                  </select>
                  <ChevronDown size={13} />
                </div>
              </div>
              <button
                className="icon-button"
                disabled={busy}
                aria-label="刷新麦克风"
                onClick={() => void refreshDevices()}
              >
                <RefreshCw size={14} />
              </button>
            </div>
            <div className="meter">
              <Volume2 size={15} />
              <div>
                {Array.from({ length: 16 }, (_, i) => (
                  <i key={i} className={level * 100 > i * 2 ? "lit" : ""} />
                ))}
              </div>
            </div>
            <button
              className={`start-button ${busy ? "pause-button" : ""}`}
              disabled={!api}
              onClick={() => void (busy ? pause() : start())}
            >
              {busy ? (
                <Pause size={17} />
              ) : (
                <Play size={17} fill="currentColor" />
              )}
              {state === "connecting"
                ? "取消连接"
                : state === "listening"
                  ? "暂停翻译"
                  : state === "paused" || state === "error"
                    ? "继续翻译"
                    : "开始翻译"}
            </button>
          </div>
          <div className="consent-line">
            <label>
              <input
                type="checkbox"
                checked={consent}
                disabled={busy}
                onChange={(e) => setConsent(e.target.checked)}
              />
              <span>
                我已获得对方同意，将音频和转写发送至云端服务进行处理。
              </span>
            </label>
          </div>
          <footer>
            <span>
              <ShieldCheck size={13} />
              音频发送至 Deepgram · 转写发送至 DeepL · 密钥加密保存在本机
            </span>
            <span>
              <Wifi size={13} />
              {latency === undefined
                ? "等待首次翻译"
                : `最近翻译耗时 ${(latency / 1000).toFixed(1)}s`}
            </span>
          </footer>
        </section>
      </main>
      {showSettings && (
        <SettingsDialog
          api={api}
          settings={settings}
          busy={busy}
          close={() => setShowSettings(false)}
          saved={(value) => {
            setSettings(value);
            setShowSettings(false);
            setError("");
          }}
        />
      )}
      {showHelp && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="help-title"
          >
            <button
              className="modal-close icon-button"
              aria-label="关闭说明"
              onClick={() => setShowHelp(false)}
            >
              <X size={19} />
            </button>
            <div className="eyebrow">QUICK START</div>
            <h2 id="help-title">开始前的三件小事</h2>
            <ol className="help-list">
              <li>
                在「服务设置」中填写 Deepgram 和 DeepL API 密钥。DeepL
                网页版订阅不能代替 API 账户。
              </li>
              <li>选择麦克风，获得对方对收音及云端处理的同意，再点击开始。</li>
              <li>
                尽量轮流说话，将麦克风放在双方之间。暂不区分说话人，仅识别韩语。
              </li>
            </ol>
            <p className="modal-note">
              暂停会停止收音和新请求；已上传的数据可能仍在服务端处理。未定稿语音不会保留。断网后点击继续，缺失语音不会补录。关闭窗口会清空全部字幕。翻译耗时不包含识别等待时间。
            </p>
            <button className="primary full" onClick={() => setShowHelp(false)}>
              知道了
            </button>
          </section>
        </div>
      )}
      {confirmClear && (
        <div className="modal-backdrop">
          <section
            className="modal compact"
            role="dialog"
            aria-modal="true"
            aria-labelledby="clear-title"
          >
            <h2 id="clear-title">清除本次字幕？</h2>
            <p>收音会暂停，所有原文和译文将从本次窗口移除，无法恢复。</p>
            <div className="modal-actions">
              <button onClick={() => setConfirmClear(false)}>取消</button>
              <button className="danger" onClick={() => void clear()}>
                清除字幕
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
function SettingsDialog({
  api,
  settings,
  busy,
  close,
  saved,
}: {
  api?: DesktopAPI;
  settings?: SettingsStatus;
  busy: boolean;
  close: () => void;
  saved: (settings: SettingsStatus) => void;
}) {
  const [deepgramKey, setDeepgram] = useState("");
  const [deeplKey, setDeepl] = useState("");
  const [plan, setPlan] = useState<"free" | "pro">(
    settings?.deeplPlan ?? "free",
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!api) return;
    setSaving(true);
    setError("");
    try {
      saved(await api.saveSettings({ deepgramKey, deeplKey, deeplPlan: plan }));
    } catch (err) {
      setError(microphoneError(err));
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="modal-backdrop">
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <button
          className="modal-close icon-button"
          aria-label="关闭设置"
          onClick={close}
        >
          <X size={19} />
        </button>
        <div className="settings-icon">
          <Settings2 size={23} />
        </div>
        <h2 id="settings-title">连接翻译服务</h2>
        <p>使用你自己的 API 密钥，服务费用由对应账户承担。</p>
        <form onSubmit={(e) => void submit(e)}>
          <label className="field-label" htmlFor="deepgram">
            Deepgram API Key{" "}
            {settings?.deepgram && (
              <span>
                <Check size={12} />
                已保存
              </span>
            )}
          </label>
          <input
            autoFocus
            id="deepgram"
            type="password"
            autoComplete="off"
            placeholder={
              settings?.deepgram
                ? "留空保留已保存的密钥"
                : "用于韩语流式语音识别"
            }
            value={deepgramKey}
            onChange={(e) => setDeepgram(e.target.value)}
            disabled={busy}
          />
          <label className="field-label" htmlFor="deepl">
            DeepL API Key{" "}
            {settings?.deepl && (
              <span>
                <Check size={12} />
                已保存
              </span>
            )}
          </label>
          <input
            id="deepl"
            type="password"
            autoComplete="off"
            placeholder={
              settings?.deepl
                ? "留空保留已保存的密钥"
                : "用于韩语 → 简体中文翻译"
            }
            value={deeplKey}
            onChange={(e) => setDeepl(e.target.value)}
            disabled={busy}
          />
          <label className="field-label" htmlFor="plan">
            DeepL API 账户
          </label>
          <select
            id="plan"
            value={plan}
            onChange={(e) => setPlan(e.target.value as "free" | "pro")}
            disabled={busy}
          >
            <option value="free">API Free</option>
            <option value="pro">API Pro</option>
          </select>
          <p className="modal-note">
            <ShieldCheck size={14} />
            密钥由系统安全存储加密，不会写入代码或字幕。
            {busy && "请先暂停翻译，再修改设置。"}
            {settings && !settings.secureStorage && "系统安全存储不可用。"}
          </p>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <button
            className="primary full"
            disabled={
              !api ||
              busy ||
              saving ||
              (!deepgramKey.trim() && !settings?.deepgram) ||
              (!deeplKey.trim() && !settings?.deepl)
            }
          >
            {saving ? "正在保存…" : "保存设置"}
          </button>
        </form>
      </section>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
