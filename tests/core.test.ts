import { test } from "node:test";
import assert from "node:assert/strict";
import { SonioxTranscript } from "../electron/soniox.js";
import { serviceError } from "../electron/translation.js";

test("provisional tokens replace rather than duplicate, final tokens persist independently", () => {
  const tracker = new SonioxTranscript();
  assert.deepEqual(tracker.accept({ tokens: [
    { text: "안녕", is_final: false },
    { text: "你", is_final: false, translation_status: "translation" },
  ] }), { original: "안녕", translation: "你" });
  assert.deepEqual(tracker.accept({ tokens: [
    { text: "안녕하세요", is_final: true },
    { text: "你好", is_final: true, translation_status: "translation" },
    { text: "<end>", is_final: true },
  ] }), { original: "안녕하세요", translation: "你好" });
  assert.deepEqual(tracker.accept({ tokens: [
    { text: " 감사합니다", is_final: true },
  ] }), { original: "안녕하세요 감사합니다", translation: "你好" });
  assert.deepEqual(tracker.accept({ tokens: [
    { text: "，谢谢", is_final: true, translation_status: "translation" },
    { text: "<fin>", is_final: true },
  ] }), { original: "안녕하세요 감사합니다", translation: "你好，谢谢" });
});
test("new connections do not inherit previous captions", () => {
  const tracker = new SonioxTranscript();
  tracker.accept({ tokens: [{ text: "old", is_final: true }] });
  assert.equal(new SonioxTranscript().accept({}).original, "");
});
test("service failures provide safe actionable authentication, budget and rate errors", () => {
  assert.match(serviceError(401, "Soniox"), /密钥无效/);
  assert.match(serviceError(402, "Soniox"), /额度/);
  assert.match(serviceError(429, "Soniox"), /频繁/);
  assert.match(serviceError(500, "Soniox"), /暂时不可用/);
});

test("optional context maps role and comma/newline separated terminology to Soniox", async () => {
  const { sonioxContext } = await import("../electron/soniox.js");
  assert.deepEqual(sonioxContext("", ""), {});
  assert.deepEqual(sonioxContext(" AI 产品经理 ", "RAG，Figma\n프로덕트 매니저, "), {
    general: [{ key: "topic", value: "AI 产品经理" }],
    terms: ["RAG", "Figma", "프로덕트 매니저"],
  });
});

test("translation direction changes both recognition hints and translation target", async () => {
  const { sonioxConfig } = await import("../electron/soniox.js");
  assert.deepEqual(sonioxConfig(48000, "ko").language_hints, ["ko"]);
  assert.equal(sonioxConfig(48000, "ko").translation.target_language, "zh");
  assert.deepEqual(sonioxConfig(48000, "zh").language_hints, ["zh"]);
  assert.equal(sonioxConfig(48000, "zh").translation.target_language, "ko");
});

test("automatic two-way mode routes originals and delayed translations by language", async () => {
  const { BilingualTranscript, sonioxConfig } = await import("../electron/soniox.js");
  assert.deepEqual(sonioxConfig(48000, "auto").translation, { type: "two_way", language_a: "ko", language_b: "zh" });
  assert.deepEqual(sonioxConfig(48000, "auto").language_hints, ["ko", "zh"]);
  const tracker = new BilingualTranscript();
  const first = tracker.accept({ tokens: [
    { text: "안녕", language: "ko", is_final: true },
    { text: "你好", language: "zh", translation_status: "translation", is_final: true },
    { text: "谢谢", language: "zh", is_final: true },
    { text: "감사", language: "ko", translation_status: "translation", is_final: false },
  ] });
  assert.deepEqual(first, [
    { sourceLanguage: "ko", original: "안녕", translation: "你好" },
    { sourceLanguage: "zh", original: "谢谢", translation: "감사" },
  ]);
  const next = tracker.accept({ tokens: [
    { text: "감사합니다", language: "ko", source_language: "zh", translation_status: "translation", is_final: true },
  ] });
  assert.equal(next[0].original, "안녕");
  assert.equal(next[1].translation, "감사합니다");
});
