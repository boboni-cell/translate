export interface SonioxResponse {
  error_code?: number;
  tokens?: { text: string; is_final: boolean; translation_status?: string; language?: string; source_language?: string }[];
}
// Final tokens are incremental; each response replaces all provisional tokens.
// Translation has no timestamps, so keep independent streams per connection.
export class SonioxTranscript {
  private original = "";
  private translation = "";
  accept(response: SonioxResponse) {
    let pendingOriginal = "";
    let pendingTranslation = "";
    for (const token of response.tokens ?? []) {
      if (token.text === "<end>" || token.text === "<fin>") continue;
      const translated = token.translation_status === "translation";
      if (token.is_final) {
        if (translated) this.translation += token.text;
        else this.original += token.text;
      } else if (translated) pendingTranslation += token.text;
      else pendingOriginal += token.text;
    }
    return {
      original: this.original + pendingOriginal,
      translation: this.translation + pendingTranslation,
    };
  }
}

export function sonioxContext(role: string, terms: string) {
  return {
    ...(role.trim() ? { general: [{ key: "topic", value: role.trim() }] } : {}),
    ...(terms.trim() ? { terms: terms.split(/[\n,，]/).map((term) => term.trim()).filter(Boolean) } : {}),
  };
}

export function sonioxConfig(sampleRate: number, sourceLanguage: "ko" | "zh" | "auto") {
  return {
    model: "stt-rt-v5", audio_format: "s16le", sample_rate: sampleRate,
    num_channels: 1, language_hints: sourceLanguage === "auto" ? ["ko", "zh"] : [sourceLanguage],
    enable_language_identification: true,
    translation: sourceLanguage === "auto"
      ? { type: "two_way", language_a: "ko", language_b: "zh" }
      : { type: "one_way", target_language: sourceLanguage === "ko" ? "zh" : "ko" },
  };
}

// Keep the two directions independent: translated tokens have a target language,
// while original tokens carry their spoken language. They are not sentence aligned.
export class BilingualTranscript {
  private trackers = { ko: new SonioxTranscript(), zh: new SonioxTranscript() };
  accept(response: SonioxResponse) {
    return (["ko", "zh"] as const).map((sourceLanguage) => ({
      sourceLanguage,
      ...this.trackers[sourceLanguage].accept({ tokens: response.tokens?.filter((token) => {
        const source = token.translation_status === "translation"
          ? token.source_language ?? (token.language === "zh" ? "ko" : token.language === "ko" ? "zh" : undefined)
          : token.language;
        return source === sourceLanguage;
      }) }),
    }));
  }
}
