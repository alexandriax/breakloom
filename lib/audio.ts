export class SurfscapeAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private ocean: AudioBufferSourceNode | null = null;
  private surf: AudioBufferSourceNode | null = null;
  private surfGain: GainNode | null = null;
  private surfFilter: BiquadFilterNode | null = null;
  private pad: OscillatorNode[] = [];
  private engine: OscillatorNode[] = [];
  private engineGain: GainNode | null = null;
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

    const surf = this.context.createBufferSource();
    const surfFilter = this.context.createBiquadFilter();
    const surfGain = this.context.createGain();
    surf.buffer = buffer;
    surf.loop = true;
    surf.playbackRate.value = 1.18;
    surfFilter.type = "highpass";
    surfFilter.frequency.value = 1050;
    surfFilter.Q.value = 0.7;
    surfGain.gain.value = 0;
    surf.connect(surfFilter).connect(surfGain).connect(this.master);
    surf.start();
    this.surf = surf;
    this.surfFilter = surfFilter;
    this.surfGain = surfGain;

    const engineGain = this.context.createGain();
    const engineFilter = this.context.createBiquadFilter();
    engineGain.gain.value = 0;
    engineFilter.type = "lowpass";
    engineFilter.frequency.value = 360;
    engineFilter.Q.value = 2.2;
    engineGain.connect(engineFilter).connect(this.master);
    [42, 84].forEach((frequency, index) => {
      const oscillator = this.context!.createOscillator();
      oscillator.type = index ? "triangle" : "sawtooth";
      oscillator.frequency.value = frequency;
      oscillator.connect(engineGain);
      oscillator.start();
      this.engine.push(oscillator);
    });
    this.engineGain = engineGain;

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

  setVehicle(speed: number, active: boolean) {
    if (!this.context || !this.engineGain) return;
    const now = this.context.currentTime;
    const revs = Math.min(1, Math.abs(speed) / 22);
    this.engineGain.gain.cancelScheduledValues(now);
    this.engineGain.gain.linearRampToValueAtTime(active && this.enabled ? 0.025 + revs * 0.055 : 0, now + 0.09);
    this.engine.forEach((oscillator, index) => {
      oscillator.frequency.cancelScheduledValues(now);
      oscillator.frequency.linearRampToValueAtTime((index ? 86 : 43) + revs * (index ? 92 : 46), now + 0.1);
    });
  }

  setSurf(speed: number, active: boolean, setEnergy: number, barrel: number) {
    if (!this.context || !this.surfGain || !this.surfFilter || !this.surf) return;
    const now = this.context.currentTime;
    const velocity = Math.min(1, Math.max(0, speed - 5) / 13);
    const targetGain = active && this.enabled ? 0.018 + velocity * 0.14 + barrel * 0.055 + setEnergy * 0.018 : 0;
    this.surfGain.gain.cancelScheduledValues(now);
    this.surfGain.gain.linearRampToValueAtTime(targetGain, now + 0.12);
    this.surfFilter.frequency.cancelScheduledValues(now);
    this.surfFilter.frequency.linearRampToValueAtTime(900 + velocity * 1250 + barrel * 420, now + 0.12);
    this.surf.playbackRate.cancelScheduledValues(now);
    this.surf.playbackRate.linearRampToValueAtTime(1.02 + velocity * 0.38 + barrel * 0.08, now + 0.12);
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
