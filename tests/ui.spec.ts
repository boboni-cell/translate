import { test, expect, _electron as electron } from "@playwright/test";
import path from "node:path";
import os from "node:os";
import { mkdtemp, rm } from "node:fs/promises";

test("browser preview is explicit and service settings never start recording", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByText("当前为浏览器界面预览。实时翻译请运行桌面应用。"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "开始翻译", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "配置翻译服务" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("button", { name: "保存设置" })).toBeDisabled();
  await page.screenshot({ path: "test-results/settings.png" });
  await page.getByRole("button", { name: "关闭设置" }).click();
  await page.screenshot({ path: "test-results/workspace.png" });
});

test("stream updates retain one row and clear discards the session", async ({
  page,
}) => {
  await page.addInitScript(() => {
    let listener: (event: unknown) => void;
    Object.assign(window, {
      testEmit: (event: unknown) => listener(event),
      desktop: {
        settings: async () => ({
          soniox: true,
          secureStorage: true,
        }),
        onEvent: (fn: typeof listener) => {
          listener = fn;
          return () => {};
        },
        pause: async () => listener({ type: "status", state: "paused" }),
        clear: async () => {},
      },
    });
  });
  await page.goto("/");
  await page.evaluate(() => {
    const emit = (window as any).testEmit;
    emit({
      type: "segment",
      id: "a",
      original: "안녕하세요.",
      timestamp: Date.now(),
      confidence: 0.95,
    });
    emit({
      type: "segment",
      id: "b",
      original: "감사합니다.",
      timestamp: Date.now(),
      confidence: 0.6,
    });
    emit({ type: "translation", id: "b", text: "谢谢。", latency: 100 });
    emit({ type: "translation", id: "a", text: "你好。", latency: 0 });
    emit({ type: "segment", id: "a", original: "안녕하세요. 반갑습니다.", timestamp: Date.now(), confidence: 0.95 });
  });
  const rows = page.locator(".transcript-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("你好。");
  await expect(rows.nth(0)).toContainText("반갑습니다.");
  await expect(rows.nth(1)).toContainText("감사합니다.");
  await expect(rows.nth(1)).toContainText("谢谢。");
  await expect(rows.nth(1)).toContainText("识别待确认");
  await page.screenshot({ path: "test-results/subtitles.png" });
  await page.getByRole("button", { name: "清除字幕", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "清除字幕", exact: true })
    .click();
  await expect(rows).toHaveCount(0);
  await expect(page.getByText("准备好，开始一段对话")).toBeVisible();
});

test("Electron opens with sandboxed preload and denies start without consent", async () => {
  const profile = await mkdtemp(path.join(os.tmpdir(), "translate-smoke-"));
  const app = await electron.launch({
    args: [".", `--user-data-dir=${profile}`],
    timeout: 60_000,
  });
  try {
    const page = await app.firstWindow();
    await expect(
      page.getByRole("heading", { name: "让语言，不再是距离。" }),
    ).toBeVisible();
    const result = await page.evaluate(async () => {
      const desktop = (window as any).desktop;
      const settings = await desktop.settings();
      let error = "";
      try {
        await desktop.start(48000, false);
      } catch (err) {
        error = String(err);
      }
      return {
        settings,
        error,
        nodeExposed: typeof (window as any).require !== "undefined",
      };
    });
    expect(result.error).toContain("请先确认对方同意");
    expect(result.nodeExposed).toBe(false);
    expect(result.settings).not.toHaveProperty("sonioxKey");
    await page.screenshot({ path: "test-results/electron.png" });
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test("microphone produces PCM frames and stopping releases every track", async ({
  browser,
}) => {
  const context = await browser.newContext({ permissions: ["microphone"] });
  const page = await context.newPage();
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { Microphone } = await import("/src/audio.ts");
    let frames = 0;
    let bytes = 0;
    let lastFrame = 0;
    const mic = new Microphone(
      (frame: ArrayBuffer) => {
        frames++;
        bytes += frame.byteLength;
        lastFrame = performance.now();
      },
      () => {},
      () => {},
    );
    const rate = await mic.prepare("");
    await mic.resume();
    await new Promise((resolve) => setTimeout(resolve, 600));
    mic.stop();
    const stoppedFrames = frames;
    await new Promise((resolve) => setTimeout(resolve, 200));
    return { rate, frames, bytes, stoppedFrames, lastFrame };
  });
  expect(result.rate).toBeGreaterThanOrEqual(8000);
  expect(result.frames).toBeGreaterThan(0);
  expect(result.bytes).toBe(result.frames * 8192);
  expect(result.frames).toBe(result.stoppedFrames);
  await context.close();
});
