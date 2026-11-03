import { test, expect, _electron as electron } from "@playwright/test";
import path from "node:path";
import os from "node:os";
import { mkdtemp, rm, readFile } from "node:fs/promises";

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
  await page.getByLabel("翻译方向").selectOption("zh");
  await expect(page.locator(".column-head")).toContainText("中文原文");
  await expect(page.locator(".column-head")).toContainText("韩语翻译");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("韩 → 中");
  await page.getByLabel("翻译方向").selectOption("ko");
  await expect(page.locator(".column-head")).toContainText("韩语原文");
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
    await page.getByRole("button", { name: "打开设置" }).click();
    await page.getByLabel("Soniox API Key").fill("test-not-a-real-key");
    await page.getByLabel("岗位 / 交流背景（可选）").fill("AI 产品经理");
    await page.getByLabel("专业术语（可选）").fill("RAG，Figma");
    await page.getByRole("button", { name: "保存设置" }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await page.getByRole("button", { name: "打开设置" }).click();
    await expect(page.getByLabel("Soniox API Key")).toHaveValue("");
    await expect(page.getByLabel("岗位 / 交流背景（可选）")).toHaveValue("AI 产品经理");
    await expect(page.getByLabel("专业术语（可选）")).toHaveValue("RAG，Figma");
    await app.evaluate(({ app }, documents) => app.setPath("documents", documents), profile);
    const archived = await page.evaluate(async () => window.desktop!.archiveRecording(new Uint8Array([26, 69, 223, 163]).buffer));
    expect(archived).toContain(path.join(profile, "听译记录"));
    expect([...await readFile(archived)]).toEqual([26, 69, 223, 163]);
    const recordingPath = path.join(profile, "recording.webm");
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, recordingPath);
    const saved = await page.evaluate(async () => window.desktop!.saveRecording(new Uint8Array([26, 69, 223, 163]).buffer));
    expect(saved).toBe(true);
    expect([...await readFile(recordingPath)]).toEqual([26, 69, 223, 163]);
    await app.evaluate(({ dialog }) => {
      dialog.showSaveDialog = async () => ({ canceled: true, filePath: undefined });
    });
    expect(await page.evaluate(async () => window.desktop!.saveRecording(new Uint8Array([1]).buffer))).toBe(false);
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
    const recorded = new Promise<Blob>((resolve) => mic.startRecording(resolve));
    await mic.resume();
    await new Promise((resolve) => setTimeout(resolve, 600));
    mic.stop();
    const blob = await recorded;
    const decoded = new AudioContext();
    const audio = await decoded.decodeAudioData(await blob.arrayBuffer());
    const duration = audio.duration;
    await decoded.close();
    const stoppedFrames = frames;
    await new Promise((resolve) => setTimeout(resolve, 200));
    return { rate, frames, bytes, stoppedFrames, lastFrame, recordingSize: blob.size, duration };
  });
  expect(result.rate).toBeGreaterThanOrEqual(8000);
  expect(result.frames).toBeGreaterThan(0);
  expect(result.bytes).toBe(result.frames * 8192);
  expect(result.frames).toBe(result.stoppedFrames);
  expect(result.recordingSize).toBeGreaterThan(0);
  expect(result.duration).toBeGreaterThan(0.3);
  await context.close();
});

test("local recording is opt-in, can be previewed and saved after pause", async ({ browser }) => {
  const context = await browser.newContext({ permissions: ["microphone"] });
  const page = await context.newPage();
  await page.addInitScript(() => {
    let listener: (event: unknown) => void;
    Object.assign(window, { desktop: {
      settings: async () => ({ soniox: true, secureStorage: true, role: "", terms: "" }),
      onEvent: (fn: typeof listener) => { listener = fn; return () => {}; },
      start: async () => listener({ type: "status", state: "listening" }), audio: () => {}, pause: async () => {}, clear: async () => {},
      archiveRecording: async () => "saved.webm",
      saveRecording: async (data: ArrayBuffer) => data.byteLength > 0,
    } });
  });
  await page.goto("/");
  const recording = page.getByRole("checkbox", { name: "同时录音（本地）" });
  await expect(recording).not.toBeChecked();
  await recording.check();
  await page.getByRole("checkbox", { name: /我已获得对方/ }).check();
  await page.getByRole("button", { name: "开始翻译", exact: true }).click();
  await expect(recording).toBeDisabled();
  await expect.poll(() => page.locator(".recording-panel").textContent()).toContain("正在录音");
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: "暂停翻译", exact: true }).click();
  await expect(page.locator(".recording-item audio")).toBeVisible();
  await page.getByRole("button", { name: "保存录音", exact: true }).click();
  await expect(page.locator(".recording-item")).toContainText("已保存");
  await page.getByRole("button", { name: "移除", exact: true }).click();
  await expect(page.locator(".recording-item")).toHaveCount(0);
  await context.close();
});
