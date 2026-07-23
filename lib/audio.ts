import type { GamePhase } from "./game";

type EffectKind = "catch" | "duck" | "shorebreak" | "release" | "turn" | "wipeout" | "finish" | "coach";

const CHORDS = [
  [0, 7, 12, 19],
  [0, 5, 12, 17],
  [0, 3, 10, 15],
] as const;

const MELODIC_PATTERNS = [
  [0, 2, 1, 3, 2, 1, 0, 2, 3, 2, 1, 0, 1, 2, 1, 3],
  [0, 1, 3, 2, 1, 2, 0, 3, 2, 3, 1, 0, 2, 1, 3, 2],
  [0, 3, 2, 1, 3, 1, 2, 0, 2, 3, 0, 1, 3, 2, 1, 0],
] as const;

function precipitationLevel(weatherCode: number) {
  if ([51, 56, 61, 66, 80].includes(weatherCode)) return .42;
  if ([53, 63, 81].includes(weatherCode)) return .68;
  if ([55, 57, 65, 67, 82, 95, 96, 99].includes(weatherCode)) return 1;
  return 0;
}

function ramp(parameter: AudioParam, value: number, now: number, duration = .12) {
  parameter.cancelScheduledValues(now);
  parameter.setValueAtTime(parameter.value, now);
  parameter.linearRampToValueAtTime(value, now + duration);
}

export class SurfscapeAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private reverb: ConvolverNode | null = null;
  private reverbGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private oceanGain: GainNode | null = null;
  private oceanFilter: BiquadFilterNode | null = null;
  private undertowGain: GainNode | null = null;
  private foamGain: GainNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private rainGain: GainNode | null = null;
  private rainFilter: BiquadFilterNode | null = null;

  private surf: AudioBufferSourceNode | null = null;
  private surfGain: GainNode | null = null;
  private surfFilter: BiquadFilterNode | null = null;

  private score: OscillatorNode[] = [];
  private scoreGain: GainNode | null = null;
  private scoreFilter: BiquadFilterNode | null = null;
  private scoreChord = -1;
  private musicBus: GainNode | null = null;
  private nextMusicStepAt = 0;
  private musicStep = 0;
  private musicEnabled = true;

  private engine: OscillatorNode[] = [];
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private roadGain: GainNode | null = null;

  private nextFoleyAt = 0;
  private nextGullAt = 0;
  private foleySide = -1;
  private enabled = true;

  async start() {
    if (typeof window === "undefined") return;
    if (this.context) {
      if (this.context.state === "suspended") await this.context.resume();
      return;
    }

    const context = new window.AudioContext({ latencyHint: "interactive" });
    this.context = context;
    this.noiseBuffer = this.createCoastalNoise(context, 7);

    const master = context.createGain();
    const compressor = context.createDynamicsCompressor();
    master.gain.value = this.enabled ? .42 : 0;
    compressor.threshold.value = -17;
    compressor.knee.value = 19;
    compressor.ratio.value = 3.2;
    compressor.attack.value = .008;
    compressor.release.value = .32;
    master.connect(compressor).connect(context.destination);
    this.master = master;

    const reverb = context.createConvolver();
    const reverbGain = context.createGain();
    reverb.buffer = this.createImpulse(context, 1.65, 2.65);
    reverbGain.gain.value = .18;
    reverb.connect(reverbGain).connect(master);
    this.reverb = reverb;
    this.reverbGain = reverbGain;

    const ocean = this.loopNoise(.72, 0.31);
    const oceanFilter = context.createBiquadFilter();
    const oceanGain = context.createGain();
    oceanFilter.type = "lowpass";
    oceanFilter.frequency.value = 720;
    oceanFilter.Q.value = .55;
    oceanGain.gain.value = .24;
    ocean.connect(oceanFilter).connect(oceanGain).connect(master);
    this.sendToReverb(oceanFilter, .06);
    this.oceanFilter = oceanFilter;
    this.oceanGain = oceanGain;

    const undertow = this.loopNoise(.51, 2.18);
    const undertowFilter = context.createBiquadFilter();
    const undertowGain = context.createGain();
    undertowFilter.type = "lowpass";
    undertowFilter.frequency.value = 185;
    undertowFilter.Q.value = 1.1;
    undertowGain.gain.value = .065;
    undertow.connect(undertowFilter).connect(undertowGain).connect(master);
    this.undertowGain = undertowGain;

    const foam = this.loopNoise(1.34, 4.06);
    const foamFilter = context.createBiquadFilter();
    const foamGain = context.createGain();
    foamFilter.type = "highpass";
    foamFilter.frequency.value = 2750;
    foamGain.gain.value = .022;
    foam.connect(foamFilter).connect(foamGain).connect(master);
    this.sendToReverb(foamFilter, .025);
    this.foamGain = foamGain;

    const wind = this.loopNoise(.87, 1.24);
    const windFilter = context.createBiquadFilter();
    const windGain = context.createGain();
    windFilter.type = "bandpass";
    windFilter.frequency.value = 1280;
    windFilter.Q.value = .46;
    windGain.gain.value = .012;
    wind.connect(windFilter).connect(windGain).connect(master);
    this.sendToReverb(windFilter, .04);
    this.windFilter = windFilter;
    this.windGain = windGain;

    const rain = this.loopNoise(1.72, 5.74);
    const rainFilter = context.createBiquadFilter();
    const rainGain = context.createGain();
    rainFilter.type = "bandpass";
    rainFilter.frequency.value = 2850;
    rainFilter.Q.value = .42;
    rainGain.gain.value = 0;
    rain.connect(rainFilter).connect(rainGain).connect(master);
    this.sendToReverb(rainFilter, .035);
    this.rainFilter = rainFilter;
    this.rainGain = rainGain;

    const surf = this.loopNoise(1.16, 3.12);
    const surfFilter = context.createBiquadFilter();
    const surfGain = context.createGain();
    surfFilter.type = "highpass";
    surfFilter.frequency.value = 980;
    surfFilter.Q.value = .65;
    surfGain.gain.value = 0;
    surf.connect(surfFilter).connect(surfGain).connect(master);
    this.sendToReverb(surfFilter, .08);
    this.surf = surf;
    this.surfFilter = surfFilter;
    this.surfGain = surfGain;

    const musicBus = context.createGain();
    const musicCompressor = context.createDynamicsCompressor();
    musicBus.gain.value = this.musicEnabled ? 1 : 0;
    musicCompressor.threshold.value = -22;
    musicCompressor.knee.value = 16;
    musicCompressor.ratio.value = 2.4;
    musicCompressor.attack.value = .018;
    musicCompressor.release.value = .38;
    musicBus.connect(musicCompressor).connect(master);
    this.sendToReverb(musicBus, .22);
    this.musicBus = musicBus;

    this.createScore();
    this.createEngine();
    this.nextGullAt = context.currentTime + 5 + Math.random() * 5;
    this.nextMusicStepAt = context.currentTime + .12;
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!this.context || !this.master) return;
    ramp(this.master.gain, enabled ? .42 : 0, this.context.currentTime, .18);
  }

  setMusicEnabled(enabled: boolean) {
    this.musicEnabled = enabled;
    if (!this.context || !this.musicBus) return;
    ramp(this.musicBus.gain, enabled ? 1 : 0, this.context.currentTime, .32);
    if (enabled) this.nextMusicStepAt = this.context.currentTime + .08;
  }

  setEnvironment(windSpeed: number, waveHeight: number, cloudCover: number, intensity = 1, weatherCode = 0) {
    if (!this.context) return;
    const now = this.context.currentTime;
    const wind = Math.min(1.4, Math.max(0, windSpeed) / 24);
    const sea = Math.min(1.5, Math.max(.1, waveHeight) / 2.4);
    const clouds = Math.min(1, Math.max(0, cloudCover) / 100);
    const rain = precipitationLevel(weatherCode);
    const sceneIntensity = Math.min(1, Math.max(.2, intensity));

    if (this.oceanGain) ramp(this.oceanGain.gain, (.18 + sea * .16) * sceneIntensity, now, .7);
    if (this.oceanFilter) ramp(this.oceanFilter.frequency, 570 + sea * 430 + wind * 90, now, .8);
    if (this.undertowGain) ramp(this.undertowGain.gain, (.035 + sea * .07) * sceneIntensity, now, .8);
    if (this.foamGain) ramp(this.foamGain.gain, (.012 + sea * .032 + wind * .012) * sceneIntensity, now, .55);
    if (this.windGain) ramp(this.windGain.gain, (.004 + Math.pow(wind, 1.55) * .105 + clouds * .009) * sceneIntensity, now, .7);
    if (this.windFilter) ramp(this.windFilter.frequency, 850 + wind * 1550 + clouds * 180, now, .8);
    if (this.rainGain) ramp(this.rainGain.gain, rain * .09 * sceneIntensity, now, .65);
    if (this.rainFilter) ramp(this.rainFilter.frequency, 2250 + rain * 1450 + wind * 260, now, .7);

    if (this.enabled && sceneIntensity > .55 && now >= this.nextGullAt && wind < 1.05 && rain === 0) {
      this.gull(now);
      this.nextGullAt = now + 8 + Math.random() * 11;
    }
  }

  setVehicle(speed: number, active: boolean) {
    if (!this.context || !this.engineGain || !this.engineFilter || !this.roadGain) return;
    const now = this.context.currentTime;
    const revs = Math.min(1, Math.abs(speed) / 19);
    const gear = Math.min(3, Math.floor(Math.abs(speed) / 5.3));
    ramp(this.engineGain.gain, active && this.enabled ? .018 + revs * .072 : 0, now, .1);
    ramp(this.roadGain.gain, active && this.enabled ? .004 + Math.pow(revs, 1.3) * .078 : 0, now, .12);
    ramp(this.engineFilter.frequency, 270 + revs * 680 + gear * 70, now, .11);
    this.engine.forEach((oscillator, index) => {
      const base = [43, 86, 129][index] ?? 43;
      ramp(oscillator.frequency, base + revs * base * .92 - gear * 3.8, now, .1);
    });
  }

  setSurf(speed: number, active: boolean, setEnergy: number, barrel: number) {
    if (!this.context || !this.surfGain || !this.surfFilter || !this.surf) return;
    const now = this.context.currentTime;
    const velocity = Math.min(1, Math.max(0, speed - 4.5) / 13);
    const targetGain = active && this.enabled ? .016 + velocity * .13 + barrel * .068 + setEnergy * .02 : 0;
    ramp(this.surfGain.gain, targetGain, now, .12);
    ramp(this.surfFilter.frequency, 820 + velocity * 1550 + barrel * 520, now, .12);
    ramp(this.surf.playbackRate, 1.0 + velocity * .36 + barrel * .1, now, .12);
  }

  setScore(
    phase: GamePhase,
    setEnergy: number,
    barrel: number,
    timeOfDay: number,
    weatherCode: number,
    active: boolean,
  ) {
    if (!this.context || !this.scoreGain || !this.scoreFilter || !this.musicBus) return;
    const now = this.context.currentTime;
    const night = timeOfDay < 6 || timeOfDay > 19.25;
    const rain = precipitationLevel(weatherCode);
    const riding = phase === "riding";
    const driving = phase === "driving";
    const paddling = phase === "paddling" || phase === "wading";
    const intensity = riding ? .8 + setEnergy * .36 + barrel * .42 : driving ? .66 : paddling ? .48 + setEnergy * .18 : .32;
    const scoreLevel = this.enabled && this.musicEnabled
      ? active
        ? .012 + intensity * .026
        : .006
      : 0;
    ramp(this.scoreGain.gain, scoreLevel, now, .65);
    ramp(this.scoreFilter.frequency, (night ? 390 : 520) + setEnergy * 390 + barrel * 860 - rain * 130, now, .7);
    const chord = barrel > .48 ? 2 : setEnergy > .64 || driving ? 1 : 0;
    if (chord !== this.scoreChord) this.setChord(chord, now);

    if (!this.enabled || !this.musicEnabled || !active) {
      this.nextMusicStepAt = now + .16;
      return;
    }
    const tempo = riding ? 94 + setEnergy * 10 : driving ? 78 : paddling ? 70 : 58;
    const stepDuration = 30 / tempo;
    if (this.nextMusicStepAt < now - .5) this.nextMusicStepAt = now + .03;
    let scheduled = 0;
    while (this.nextMusicStepAt < now + .2 && scheduled < 3) {
      this.scheduleMusicStep(
        this.nextMusicStepAt,
        phase,
        setEnergy,
        barrel,
        night,
        rain,
        stepDuration,
      );
      this.nextMusicStepAt += stepDuration;
      this.musicStep += 1;
      scheduled += 1;
    }
  }

  setMovement(phase: GamePhase, speed: number, active: boolean) {
    if (!this.context || !this.enabled || !active || speed < .35) return;
    const now = this.context.currentTime;
    if (now < this.nextFoleyAt) return;
    const pace = Math.min(1.35, Math.max(.25, speed / 4.4));
    if (phase === "shore") {
      this.footstep(now, this.foleySide);
      this.nextFoleyAt = now + .48 / pace;
    } else if (phase === "wading" || phase === "paddling") {
      this.paddle(now, this.foleySide, phase === "wading");
      this.nextFoleyAt = now + (phase === "wading" ? .52 : .64) / pace;
    } else {
      return;
    }
    this.foleySide *= -1;
  }

  effect(kind: EffectKind) {
    if (!this.enabled || !this.context || !this.master) return;
    const now = this.context.currentTime;
    if (kind === "catch") {
      this.noiseBurst(now, .48, 780, .7, .18, "bandpass", 0, .08);
      this.tone(now, 92, 176, .58, .095, "sine", 0, .12);
      this.tone(now + .055, 184, 272, .42, .036, "triangle", -.18, .2);
    } else if (kind === "duck") {
      this.noiseBurst(now, .46, 430, .7, .13, "lowpass", 0, .1);
      this.tone(now, 96, 62, .42, .055, "sine", 0, .13);
      this.noiseBurst(now + .16, .28, 980, .5, .08, "bandpass", this.foleySide * .2, .05);
    } else if (kind === "shorebreak") {
      this.noiseBurst(now, .82, 720, .76, .24, "bandpass", 0, .12);
      this.noiseBurst(now + .035, .44, 2200, .58, .1, "highpass", this.foleySide * .24, .07);
      this.tone(now, 82, 46, .62, .08, "sine", 0, .11);
    } else if (kind === "release") {
      this.noiseBurst(now, .34, 1180, .72, .13, "bandpass", this.foleySide * .28, .04);
      this.tone(now, 112, 224, .28, .035, "triangle", this.foleySide * .2, .12);
      this.tone(now + .075, 224, 168, .24, .026, "sine", -this.foleySide * .18, .16);
    } else if (kind === "turn") {
      this.noiseBurst(now, .24, 1650, .85, .14, "bandpass", this.foleySide * .36, .05);
      this.tone(now, 142, 118, .22, .04, "triangle", this.foleySide * .25, .08);
    } else if (kind === "wipeout") {
      this.noiseBurst(now, 1.25, 470, .62, .3, "bandpass", 0, .16);
      this.noiseBurst(now + .04, .72, 2100, .5, .13, "highpass", -.2, .09);
      this.tone(now, 78, 38, .78, .12, "sine", 0, .14);
    } else if (kind === "finish") {
      [0, 7, 12].forEach((semitone, index) => {
        const frequency = 164.81 * Math.pow(2, semitone / 12);
        this.tone(now + index * .075, frequency, frequency * 1.005, .85, .047, index ? "sine" : "triangle", (index - 1) * .22, .28);
      });
    } else {
      this.tone(now, 392, 523.25, .34, .022, "sine", -.16, .26);
      this.tone(now + .09, 523.25, 659.25, .42, .018, "triangle", .18, .3);
    }
  }

  private createCoastalNoise(context: AudioContext, seconds: number) {
    const buffer = context.createBuffer(2, context.sampleRate * seconds, context.sampleRate);
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const data = buffer.getChannelData(channel);
      let brown = 0;
      let pink = 0;
      for (let index = 0; index < data.length; index += 1) {
        const white = Math.random() * 2 - 1;
        brown = brown * .994 + white * .006;
        pink = pink * .93 + white * .07;
        const longSwell = Math.sin(index / context.sampleRate * Math.PI * .38 + channel * 1.7) * .08;
        data[index] = Math.max(-1, Math.min(1, brown * 7.8 + pink * .14 + white * .035 + longSwell));
      }
    }
    return buffer;
  }

  private createImpulse(context: AudioContext, seconds: number, decay: number) {
    const buffer = context.createBuffer(2, Math.floor(context.sampleRate * seconds), context.sampleRate);
    for (let channel = 0; channel < 2; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let index = 0; index < data.length; index += 1) {
        const envelope = Math.pow(1 - index / data.length, decay);
        data[index] = (Math.random() * 2 - 1) * envelope * (channel ? .88 : 1);
      }
    }
    return buffer;
  }

  private loopNoise(rate: number, offset: number) {
    const source = this.context!.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.loop = true;
    source.playbackRate.value = rate;
    source.start(0, Math.min(offset, Math.max(0, (this.noiseBuffer?.duration ?? 1) - .1)));
    return source;
  }

  private createScore() {
    const context = this.context!;
    const scoreGain = context.createGain();
    const scoreFilter = context.createBiquadFilter();
    scoreGain.gain.value = .009;
    scoreFilter.type = "lowpass";
    scoreFilter.frequency.value = 480;
    scoreFilter.Q.value = 1.15;
    scoreGain.connect(scoreFilter).connect(this.musicBus!);
    CHORDS[0].forEach((semitone, index) => {
      const oscillator = context.createOscillator();
      oscillator.type = index % 2 ? "sine" : "triangle";
      oscillator.frequency.value = 55 * Math.pow(2, semitone / 12);
      oscillator.detune.value = index * 2.5 - 3.5;
      oscillator.connect(scoreGain);
      oscillator.start();
      this.score.push(oscillator);
    });
    this.scoreGain = scoreGain;
    this.scoreFilter = scoreFilter;
    this.scoreChord = 0;
  }

  private createEngine() {
    const context = this.context!;
    const engineGain = context.createGain();
    const engineFilter = context.createBiquadFilter();
    engineGain.gain.value = 0;
    engineFilter.type = "lowpass";
    engineFilter.frequency.value = 330;
    engineFilter.Q.value = 2.1;
    engineGain.connect(engineFilter).connect(this.master!);
    this.sendToReverb(engineFilter, .025);
    [43, 86, 129].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      oscillator.type = index === 0 ? "sawtooth" : index === 1 ? "triangle" : "sine";
      oscillator.frequency.value = frequency;
      oscillator.connect(engineGain);
      oscillator.start();
      this.engine.push(oscillator);
    });
    const road = this.loopNoise(.64, 5.1);
    const roadFilter = context.createBiquadFilter();
    const roadGain = context.createGain();
    roadFilter.type = "bandpass";
    roadFilter.frequency.value = 230;
    roadFilter.Q.value = .72;
    roadGain.gain.value = 0;
    road.connect(roadFilter).connect(roadGain).connect(this.master!);
    this.engineGain = engineGain;
    this.engineFilter = engineFilter;
    this.roadGain = roadGain;
  }

  private setChord(chord: number, now: number) {
    this.scoreChord = chord;
    this.score.forEach((oscillator, index) => {
      const semitone = CHORDS[chord][index] ?? CHORDS[chord][0];
      ramp(oscillator.frequency, 55 * Math.pow(2, semitone / 12), now, 1.35 + index * .14);
    });
  }

  private scheduleMusicStep(
    at: number,
    phase: GamePhase,
    setEnergy: number,
    barrel: number,
    night: boolean,
    rain: number,
    stepDuration: number,
  ) {
    const riding = phase === "riding";
    const driving = phase === "driving";
    const paddling = phase === "paddling" || phase === "wading";
    const density = riding ? 1 : driving || paddling ? 2 : 4;
    const step = this.musicStep % 16;
    const chordIndex = Math.max(0, this.scoreChord);
    const pattern = MELODIC_PATTERNS[chordIndex] ?? MELODIC_PATTERNS[0];
    const chord = CHORDS[chordIndex] ?? CHORDS[0];
    const chordTone = chord[pattern[step] % chord.length] ?? 0;
    const octaveLift = riding && (step === 3 || step === 7 || step === 14) ? 12 : driving && step % 8 === 6 ? 12 : 0;
    const root = night ? 92.5 : 110;
    const frequency = root * Math.pow(2, (chordTone + octaveLift) / 12);
    const pan = Math.sin(step * 1.71 + chordIndex) * (riding ? .46 : .3);
    const shouldPlay = step % density === 0 || barrel > .52;
    if (shouldPlay) {
      const velocity = riding ? .028 + setEnergy * .012 + barrel * .014 : driving ? .022 : paddling ? .018 : .013;
      const brightness = (night ? 980 : 1540) + setEnergy * 920 + barrel * 1280 - rain * 360;
      this.musicPluck(at, frequency, stepDuration * (riding ? 1.65 : 2.2), velocity, pan, brightness);
    }

    if ((riding || driving) && step % 4 === 0) {
      this.musicPulse(at, riding ? .025 + setEnergy * .01 : .016);
    }
    if ((riding || paddling) && step % 4 === 2 && rain < .8) {
      this.musicShaker(at, riding ? .013 : .007, night ? 3500 : 5100);
    }
    if (barrel > .46 && step % 2 === 1) {
      this.musicPluck(at + stepDuration * .26, frequency * 2.01, stepDuration * 2.5, .012 + barrel * .012, -pan * .7, 2800 + barrel * 2200);
    }
  }

  private musicPluck(
    at: number,
    frequency: number,
    duration: number,
    gainValue: number,
    pan: number,
    brightness: number,
  ) {
    if (!this.context || !this.musicBus) return;
    const primary = this.context.createOscillator();
    const air = this.context.createOscillator();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    const panner = this.context.createStereoPanner();
    primary.type = "triangle";
    air.type = "sine";
    primary.frequency.value = frequency;
    air.frequency.value = frequency * 2.002;
    air.detune.value = 4.5;
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(Math.max(320, brightness), at);
    filter.frequency.exponentialRampToValueAtTime(Math.max(220, brightness * .38), at + duration);
    filter.Q.value = 1.8;
    gain.gain.setValueAtTime(.0001, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(.0002, gainValue), at + .018);
    gain.gain.exponentialRampToValueAtTime(.0001, at + duration);
    panner.pan.value = pan;
    primary.connect(filter);
    air.connect(filter);
    filter.connect(gain).connect(panner).connect(this.musicBus);
    primary.start(at);
    air.start(at);
    primary.stop(at + duration + .04);
    air.stop(at + duration + .04);
  }

  private musicPulse(at: number, gainValue: number) {
    if (!this.context || !this.musicBus) return;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(76, at);
    oscillator.frequency.exponentialRampToValueAtTime(38, at + .28);
    gain.gain.setValueAtTime(.0001, at);
    gain.gain.exponentialRampToValueAtTime(gainValue, at + .012);
    gain.gain.exponentialRampToValueAtTime(.0001, at + .34);
    oscillator.connect(gain).connect(this.musicBus);
    oscillator.start(at);
    oscillator.stop(at + .37);
  }

  private musicShaker(at: number, gainValue: number, frequency: number) {
    if (!this.context || !this.musicBus || !this.noiseBuffer) return;
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    const panner = this.context.createStereoPanner();
    source.buffer = this.noiseBuffer;
    filter.type = "highpass";
    filter.frequency.value = frequency;
    filter.Q.value = .42;
    gain.gain.setValueAtTime(.0001, at);
    gain.gain.exponentialRampToValueAtTime(gainValue, at + .008);
    gain.gain.exponentialRampToValueAtTime(.0001, at + .11);
    panner.pan.value = Math.sin(this.musicStep * 2.31) * .62;
    source.connect(filter).connect(gain).connect(panner).connect(this.musicBus);
    source.start(at, Math.random() * Math.max(.1, this.noiseBuffer.duration - .2), .14);
    source.stop(at + .16);
  }

  private sendToReverb(source: AudioNode, amount: number) {
    if (!this.context || !this.reverb) return;
    const send = this.context.createGain();
    send.gain.value = amount;
    source.connect(send).connect(this.reverb);
  }

  private noiseBurst(
    now: number,
    duration: number,
    frequency: number,
    q: number,
    gainValue: number,
    filterType: BiquadFilterType,
    pan: number,
    reverb: number,
  ) {
    if (!this.context || !this.noiseBuffer || !this.master) return;
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    const panner = this.context.createStereoPanner();
    source.buffer = this.noiseBuffer;
    filter.type = filterType;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    panner.pan.value = pan;
    gain.gain.setValueAtTime(.0001, now);
    gain.gain.exponentialRampToValueAtTime(gainValue, now + .018);
    gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
    source.connect(filter).connect(gain).connect(panner).connect(this.master);
    this.sendToReverb(panner, reverb);
    const maxOffset = Math.max(0, this.noiseBuffer.duration - duration - .05);
    source.start(now, Math.random() * maxOffset, duration + .02);
    source.stop(now + duration + .04);
  }

  private tone(
    now: number,
    from: number,
    to: number,
    duration: number,
    gainValue: number,
    type: OscillatorType,
    pan: number,
    reverb: number,
  ) {
    if (!this.context || !this.master) return;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const panner = this.context.createStereoPanner();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(Math.max(1, from), now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, to), now + duration);
    gain.gain.setValueAtTime(.0001, now);
    gain.gain.exponentialRampToValueAtTime(gainValue, now + .025);
    gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
    panner.pan.value = pan;
    oscillator.connect(gain).connect(panner).connect(this.master);
    this.sendToReverb(panner, reverb);
    oscillator.start(now);
    oscillator.stop(now + duration + .03);
  }

  private footstep(now: number, side: number) {
    this.noiseBurst(now, .12, 560 + Math.random() * 150, .9, .052, "bandpass", side * .32, .015);
    this.tone(now, 84, 62, .1, .018, "sine", side * .28, .01);
  }

  private paddle(now: number, side: number, wading: boolean) {
    this.noiseBurst(now, wading ? .28 : .22, wading ? 680 : 1280, .62, wading ? .075 : .062, "bandpass", side * .48, .05);
    this.tone(now, wading ? 112 : 176, wading ? 72 : 98, .2, .018, "sine", side * .38, .05);
  }

  private gull(now: number) {
    const pan = Math.random() * 1.5 - .75;
    this.tone(now, 980 + Math.random() * 120, 1450 + Math.random() * 180, .34, .009, "sine", pan, .46);
    this.tone(now + .29, 1320, 900, .29, .006, "sine", pan * .8, .5);
  }
}
