export interface RecognitionResult {
  type?: string;
  start?: number;
  duration?: number;
  is_final?: boolean;
  channel?: { alternatives?: { transcript?: string; confidence?: number }[] };
}
export class TranscriptTracker {
  private seen = new Set<string>();
  accept(
    result: RecognitionResult,
  ): { text: string; confidence: number; key: string; final: boolean } | null {
    if (result.type !== "Results") return null;
    const alternative = result.channel?.alternatives?.[0];
    const text = alternative?.transcript?.trim();
    if (!text) return null;
    const key = `${result.start ?? 0}:${result.duration ?? 0}`;
    if (result.is_final && this.seen.has(key)) return null;
    if (result.is_final) this.seen.add(key);
    return {
      text,
      confidence: alternative?.confidence ?? 0,
      key,
      final: !!result.is_final,
    };
  }
}
