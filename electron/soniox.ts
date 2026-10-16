export interface SonioxResponse {
  error_code?: number;
  tokens?: { text: string; is_final: boolean; translation_status?: string }[];
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
