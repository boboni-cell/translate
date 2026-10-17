export interface Settings { sonioxKey: string; role: string; terms: string; }
export interface SettingsStatus { soniox: boolean; secureStorage: boolean; role: string; terms: string; }
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
      sourceLanguage?: "ko" | "zh";
    }
  | { type: "translation"; id: string; text: string; latency: number }
  | { type: "translation-error"; id: string; message: string };
export interface DesktopAPI {
  settings: () => Promise<SettingsStatus>;
  saveSettings: (settings: Settings) => Promise<SettingsStatus>;
  start: (sampleRate: number, consent: boolean, sourceLanguage?: "ko" | "zh") => Promise<void>;
  audio: (frame: ArrayBuffer) => void;
  pause: () => Promise<void>;
  clear: () => Promise<void>;
  onEvent: (listener: (event: SessionEvent) => void) => () => void;
}
