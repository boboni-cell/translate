export function serviceError(status: number, service: string): string {
  if (status === 401 || status === 403)
    return `${service} 密钥无效或没有访问权限，请检查设置。`;
  if (status === 429) return `${service} 请求过于频繁，请稍后重试。`;
  if (status === 456 || status === 402)
    return `${service} 额度已用尽，请检查服务账户。`;
  return `${service} 服务暂时不可用（${status}），请重试。`;
}
export async function translate(
  text: string,
  key: string,
  plan: "free" | "pro",
  signal: AbortSignal,
  request: typeof fetch = fetch,
): Promise<string> {
  const response = await request(
    `https://${plan === "free" ? "api-free" : "api"}.deepl.com/v2/translate`,
    {
      method: "POST",
      signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]),
      headers: {
        Authorization: `DeepL-Auth-Key ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: [text],
        source_lang: "KO",
        target_lang: "ZH-HANS",
      }),
    },
  );
  if (!response.ok) throw new Error(serviceError(response.status, "DeepL"));
  const body = (await response.json()) as { translations?: { text: string }[] };
  if (!body.translations?.[0]?.text)
    throw new Error("DeepL 未返回译文，请重试。");
  return body.translations[0].text;
}

// Translation concurrency is bounded; results carry IDs so completion order cannot reorder subtitles.
export class TranslationQueue {
  private pending: { id: string; text: string }[] = [];
  private running = new Set<string>();
  private failed = new Map<string, string>();
  private controllers = new Set<AbortController>();
  private generation = 0;
  constructor(
    private run: (text: string, signal: AbortSignal) => Promise<string>,
    private done: (id: string, text: string, latency: number) => void,
    private error: (id: string, message: string) => void,
  ) {}
  add(id: string, text: string) {
    if (this.running.has(id) || this.pending.some((item) => item.id === id))
      return;
    if (this.pending.length >= 100) {
      this.failed.set(id, text);
      this.error(id, "翻译积压过多，已保留原文；请暂停后重试。");
      return;
    }
    this.failed.delete(id);
    this.pending.push({ id, text });
    this.pump();
  }
  retry(id: string) {
    const text = this.failed.get(id);
    if (text) this.add(id, text);
  }
  reset() {
    this.generation++;
    this.pending = [];
    this.failed.clear();
    this.running.clear();
    for (const c of this.controllers) c.abort();
    this.controllers.clear();
  }
  private pump() {
    while (this.running.size < 2 && this.pending.length) {
      const item = this.pending.shift()!;
      const generation = this.generation;
      const controller = new AbortController();
      const start = Date.now();
      this.running.add(item.id);
      this.controllers.add(controller);
      void this.run(item.text, controller.signal)
        .then((text) => {
          if (generation === this.generation)
            this.done(item.id, text, Date.now() - start);
        })
        .catch((err: unknown) => {
          if (generation === this.generation) {
            this.failed.set(item.id, item.text);
            this.error(
              item.id,
              err instanceof Error ? err.message : "翻译失败，请重试。",
            );
          }
        })
        .finally(() => {
          if (generation === this.generation) {
            this.running.delete(item.id);
            this.controllers.delete(controller);
            this.pump();
          }
        });
    }
  }
  pause() {
    const queued = this.pending.splice(0);
    for (const item of queued) {
      this.failed.set(item.id, item.text);
      this.error(item.id, "已暂停，点击重试翻译。");
    }
    // Active requests are aborted; their catch handlers retain their source text for retry.
    for (const c of this.controllers) c.abort();
  }
}
