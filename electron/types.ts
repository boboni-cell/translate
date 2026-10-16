export interface Settings { sonioxKey: string; }
export interface SettingsStatus { soniox: boolean; secureStorage: boolean; }
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
  onEvent: (listener: (event: SessionEvent) => void) => () => void;
}
