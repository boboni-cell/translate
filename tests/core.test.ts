import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TranslationQueue,
  translate,
  serviceError,
} from "../electron/translation.js";
import { TranscriptTracker } from "../electron/transcript.js";
const tick = () => new Promise((resolve) => setImmediate(resolve));
test("only final transcripts are deduplicated by audio interval, not repeated spoken words", () => {
  const tracker = new TranscriptTracker();
  const result = {
    type: "Results",
    start: 1,
    duration: 2,
    channel: { alternatives: [{ transcript: "안녕하세요", confidence: 0.95 }] },
  };
  assert.equal(tracker.accept(result)?.final, false);
  assert.equal(tracker.accept(result)?.text, "안녕하세요");
  assert.equal(tracker.accept({ ...result, is_final: true })?.final, true);
  assert.equal(tracker.accept({ ...result, is_final: true }), null);
  assert.equal(
    tracker.accept({ ...result, start: 4, is_final: true })?.text,
    "안녕하세요",
  );
  assert.equal(tracker.accept({ type: "Metadata" }), null);
  assert.equal(
    tracker.accept({
      ...result,
      channel: { alternatives: [{ transcript: "  " }] },
    }),
    null,
  );
});
test("translation concurrency stays bounded and out-of-order results preserve segment IDs", async () => {
  const resolvers: ((text: string) => void)[] = [];
  const done: string[] = [];
  const queue = new TranslationQueue(
    () => new Promise((resolve) => resolvers.push(resolve)),
    (id, text) => done.push(`${id}:${text}`),
    assert.fail,
  );
  queue.add("one", "첫 번째");
  queue.add("two", "두 번째");
  queue.add("three", "세 번째");
  queue.add("two", "duplicate");
  assert.equal(resolvers.length, 2);
  resolvers[1]("第二");
  await tick();
  assert.equal(resolvers.length, 3);
  resolvers[0]("第一");
  resolvers[2]("第三");
  await tick();
  assert.deepEqual(done, ["two:第二", "one:第一", "three:第三"]);
});
test("failed translations can be retried without re-sending audio", async () => {
  let calls = 0;
  const errors: string[] = [];
  const results: string[] = [];
  const queue = new TranslationQueue(
    async () => {
      if (++calls === 1) throw new Error("offline");
      return "你好";
    },
    (_, text) => results.push(text),
    (_, error) => errors.push(error),
  );
  queue.add("one", "안녕하세요");
  await tick();
  assert.deepEqual(errors, ["offline"]);
  queue.retry("one");
  await tick();
  assert.deepEqual(results, ["你好"]);
});
test("clear aborts requests and ignores stale results, even if provider ignores cancellation", async () => {
  let resolveOld!: (text: string) => void;
  let signal!: AbortSignal;
  const results: string[] = [];
  const queue = new TranslationQueue(
    (_, s) => {
      signal = s;
      return new Promise((resolve) => {
        resolveOld = resolve;
      });
    },
    (_, text) => results.push(text),
    assert.fail,
  );
  queue.add("old", "old");
  queue.reset();
  assert.equal(signal.aborted, true);
  resolveOld("stale");
  await tick();
  assert.deepEqual(results, []);
});
test("pause aborts active translations, marks queued text, and retains both for retry", async () => {
  const failed: string[] = [];
  let succeed = false;
  const results: string[] = [];
  const queue = new TranslationQueue(
    (text, signal) =>
      succeed
        ? Promise.resolve(text)
        : new Promise((_, reject) =>
            signal.addEventListener("abort", () =>
              reject(new Error("aborted")),
            ),
          ),
    (id) => results.push(id),
    (id) => failed.push(id),
  );
  queue.add("a", "a");
  queue.add("b", "b");
  queue.add("c", "c");
  queue.pause();
  await tick();
  assert.deepEqual(failed.sort(), ["a", "b", "c"]);
  succeed = true;
  for (const id of failed) queue.retry(id);
  await tick();
  assert.deepEqual(results.sort(), ["a", "b", "c"]);
});
test("translation uses correct DeepL Free endpoint and Korean / simplified Chinese codes", async () => {
  const request = (async (
    url: string | URL | Request,
    options?: RequestInit,
  ) => {
    assert.equal(url, "https://api-free.deepl.com/v2/translate");
    assert.deepEqual(JSON.parse(options!.body as string), {
      text: ["안녕하세요"],
      source_lang: "KO",
      target_lang: "ZH-HANS",
    });
    assert.equal(
      (options!.headers as Record<string, string>).Authorization,
      "DeepL-Auth-Key test-key",
    );
    return new Response(JSON.stringify({ translations: [{ text: "你好" }] }));
  }) as typeof fetch;
  assert.equal(
    await translate(
      "안녕하세요",
      "test-key",
      "free",
      new AbortController().signal,
      request,
    ),
    "你好",
  );
});
test("provider errors show actionable messages and never expose credentials or response bodies", async () => {
  const request = (async () =>
    new Response("secret-provider-response", { status: 403 })) as typeof fetch;
  await assert.rejects(
    translate(
      "text",
      "secret-key",
      "pro",
      new AbortController().signal,
      request,
    ),
    /密钥无效/,
  );
  assert.match(serviceError(429, "DeepL"), /频繁/);
  assert.match(serviceError(456, "DeepL"), /额度/);
});
test("missing translation payload is reported as an error", async () => {
  const request = (async () => new Response("{}")) as typeof fetch;
  await assert.rejects(
    translate("text", "key", "pro", new AbortController().signal, request),
    /未返回译文/,
  );
});
