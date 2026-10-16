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
