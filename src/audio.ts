export class Microphone {
  private stream?: MediaStream;
  private context?: AudioContext;
  private node?: AudioWorkletNode;
  private cancelled = false;
  constructor(
    private send: (data: ArrayBuffer) => void,
    private level: (value: number) => void,
    private lost: () => void,
  ) {}
  async prepare(deviceId: string): Promise<number> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    if (this.cancelled) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error("收音已取消。");
    }
    this.stream = stream;
    this.context = new AudioContext();
    await this.context.audioWorklet.addModule(
      new URL("../public/pcm-worklet.js", import.meta.url).href,
    );
    if (this.cancelled) throw new Error("收音已取消。");
    const source = this.context.createMediaStreamSource(stream);
    this.node = new AudioWorkletNode(this.context, "pcm-processor");
    this.node.port.onmessage = (event) => {
      if (!this.cancelled) {
        this.send(event.data.pcm);
        this.level(event.data.level);
      }
    };
    // Connecting a silent output keeps the processor scheduled without microphone feedback.
    source.connect(this.node);
    this.node.connect(this.context.destination);
    for (const track of stream.getAudioTracks())
      track.addEventListener("ended", () => {
        if (!this.cancelled) this.lost();
      });
    await this.context.suspend();
    return this.context.sampleRate;
  }
  async resume() {
    if (!this.cancelled) await this.context?.resume();
  }
  stop() {
    this.cancelled = true;
    this.node?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    if (this.context && this.context.state !== "closed")
      void this.context.close();
    this.level(0);
  }
}
export function microphoneError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError")
      return "麦克风权限被拒绝，请在系统设置 → 隐私与安全性 → 麦克风中开启权限。";
    if (error.name === "NotFoundError")
      return "未找到麦克风，请连接设备后刷新列表。";
    if (error.name === "NotReadableError")
      return "无法读取麦克风，设备可能被占用或已断开。";
    if (error.name === "OverconstrainedError")
      return "所选麦克风已不可用，请重新选择。";
  }
  return error instanceof Error
    ? error.message.replace(
        /^Error invoking remote method '[^']+': Error: /,
        "",
      )
    : "启动失败，请重试。";
}
