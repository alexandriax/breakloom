export class SurfscapeAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private ocean: AudioBufferSourceNode | null = null;
  private pad: OscillatorNode[] = [];
  private enabled = true;

  async start() {
    if (typeof window === "undefined") return;
    if (this.context) {
      if (this.context.state === "suspended") await this.context.resume();
      return;
    }
    const AudioContextClass = window.AudioContext;
    this.context = new AudioContextClass();
    this.master = this.context.createGain();
    this.master.gain.value = this.enabled ? 0.36 : 0;
    this.master.connect(this.context.destination);

    const seconds = 4;
    const buffer = this.context.createBuffer(2, this.context.sampleRate * seconds, this.context.sampleRate);
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const data = buffer.getChannelData(channel);
      let last = 0;
      for (let index = 0; index < data.length; index += 1) {
        const white = Math.random() * 2 - 1;
        last = last * 0.985 + white * 0.015;
        const envelope = 0.34 + Math.pow(Math.sin((index / data.length) * Math.PI * 2), 8) * 0.28;
        data[index] = last * 5.5 * envelope;
      }
    }
    const ocean = this.context.createBufferSource();
    const oceanFilter = this.context.createBiquadFilter();
    const oceanGain = this.context.createGain();
    ocean.buffer = buffer;
    ocean.loop = true;
    oceanFilter.type = "lowpass";
    oceanFilter.frequency.value = 920;
    oceanGain.gain.value = 0.34;
    ocean.connect(oceanFilter).connect(oceanGain).connect(this.master);
    ocean.start();
    this.ocean = ocean;

    const padGain = this.context.createGain();
    const padFilter = this.context.createBiquadFilter();
    padGain.gain.value = 0.025;
    padFilter.type = "lowpass";
    padFilter.frequency.value = 520;
    padFilter.Q.value = 1.4;
    padGain.connect(padFilter).connect(this.master);
    [55, 82.41, 110, 146.83].forEach((frequency, index) => {
      const oscillator = this.context!.createOscillator();
      oscillator.type = index % 2 ? "sine" : "triangle";
      oscillator.frequency.value = frequency;
      oscillator.detune.value = index * 3 - 4;
      oscillator.connect(padGain);
      oscillator.start();
      this.pad.push(oscillator);
    });
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (this.context && this.master) {
      this.master.gain.cancelScheduledValues(this.context.currentTime);
      this.master.gain.linearRampToValueAtTime(enabled ? 0.36 : 0, this.context.currentTime + 0.15);
    }
  }

  effect(kind: "catch" | "turn" | "wipeout" | "finish") {
    if (!this.enabled || !this.context || !this.master) return;
    const context = this.context;
    const now = context.currentTime;
    const gain = context.createGain();
    const filter = context.createBiquadFilter();
    gain.connect(filter).connect(this.master);
    if (kind === "catch" || kind === "finish") {
      const oscillator = context.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(kind === "finish" ? 220 : 110, now);
      oscillator.frequency.exponentialRampToValueAtTime(kind === "finish" ? 440 : 180, now + 0.55);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.15, now + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
      filter.type = "lowpass";
      filter.frequency.value = 1200;
      oscillator.connect(gain);
      oscillator.start(now);
      oscillator.stop(now + 0.85);
      return;
    }
    const length = kind === "wipeout" ? 1.2 : 0.2;
    const buffer = context.createBuffer(1, context.sampleRate * length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) {
      data[index] = (Math.random() * 2 - 1) * Math.pow(1 - index / data.length, kind === "wipeout" ? 0.7 : 2.5);
    }
    const source = context.createBufferSource();
    filter.type = "bandpass";
    filter.frequency.value = kind === "wipeout" ? 440 : 1250;
    filter.Q.value = 0.7;
    gain.gain.value = kind === "wipeout" ? 0.28 : 0.13;
    source.buffer = buffer;
    source.connect(gain);
    source.start();
  }
}

