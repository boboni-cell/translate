export interface Settings {
  deepgramKey: string;
  deeplKey: string;
  deeplPlan: "free" | "pro";
}
export interface SettingsStatus {
  deepgram: boolean;
  deepl: boolean;
  deeplPlan: "free" | "pro";
  secureStorage: boolean;
}
export type SessionEvent =
  | {
      type: "status";
      state: "connecting" | "listening" | "paused" | "error";
      message?: string;
    }
  | { type: "interim"; text: string }
  | {
      type: "segment";
      id: string;
      original: string;
      timestamp: number;
      confidence: number;
    }
  | { type: "translation"; id: string; text: string; latency: number }
  | { type: "translation-error"; id: string; message: string };
export interface DesktopAPI {
  settings: () => Promise<SettingsStatus>;
  saveSettings: (settings: Settings) => Promise<SettingsStatus>;
  start: (sampleRate: number, consent: boolean) => Promise<void>;
  audio: (frame: ArrayBuffer) => void;
  pause: () => Promise<void>;
  clear: () => Promise<void>;
  retry: (id: string) => Promise<void>;
  onEvent: (listener: (event: SessionEvent) => void) => () => void;
}
