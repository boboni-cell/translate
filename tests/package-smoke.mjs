import { _electron as electron } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const profile = await mkdtemp(path.join(os.tmpdir(), "translate-package-"));
const app = await electron.launch({
  executablePath: path.resolve(
    `release/mac${process.arch === "arm64" ? "-arm64" : ""}/听译.app/Contents/MacOS/听译`,
  ),
  args: [
    `--user-data-dir=${profile}`,
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
  ],
});
try {
  const page = await app.firstWindow();
  await page.getByRole("heading", { name: "让语言，不再是距离。" }).waitFor();
  assert.equal(new URL(page.url()).protocol, "file:");
  const result = await page.evaluate(async () => {
    const config = await window.desktop.settings();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const context = new AudioContext();
    await context.audioWorklet.addModule(
      new URL("pcm-worklet.js", location.href).href,
    );
    const source = context.createMediaStreamSource(stream);
    const processor = new AudioWorkletNode(context, "pcm-processor");
    let frames = 0;
    processor.port.onmessage = () => frames++;
    source.connect(processor);
    processor.connect(context.destination);
    await context.resume();
    await new Promise((resolve) => setTimeout(resolve, 500));
    stream.getTracks().forEach((track) => track.stop());
    processor.disconnect();
    await context.close();
    return {
      configured: typeof config.deepgram === "boolean",
      frames,
      allEnded: stream
        .getTracks()
        .every((track) => track.readyState === "ended"),
    };
  });
  assert.equal(result.configured, true);
  assert.ok(result.frames > 0);
  assert.equal(result.allEnded, true);
  await page.screenshot({ path: "test-results/packaged.png" });
  console.log(
    "Packaged Mac app: production UI, preload IPC, PCM worklet and microphone release passed.",
  );
} finally {
  await app.close();
  await rm(profile, { recursive: true, force: true });
}
