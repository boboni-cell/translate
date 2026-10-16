// Batch ~85 ms at 48 kHz. Audio never touches disk.
class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Int16Array(4096);
    this.offset = 0;
  }
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    let energy = 0;
    for (let i = 0; i < channel.length; i++) {
      const value = Math.max(-1, Math.min(1, channel[i]));
      energy += value * value;
      this.buffer[this.offset++] = value < 0 ? value * 32768 : value * 32767;
      if (this.offset === this.buffer.length) {
        this.port.postMessage(
          {
            pcm: this.buffer.buffer,
            level: Math.sqrt(energy / channel.length),
          },
          [this.buffer.buffer],
        );
        this.buffer = new Int16Array(4096);
        this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor("pcm-processor", PCMProcessor);
