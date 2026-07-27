import type { GamePhase } from "./game";
import type { CoastBiome } from "./beaches";

type EffectKind = "catch" | "duck" | "shorebreak" | "release" | "turn" | "leash" | "wipeout" | "finish" | "coach" | "door";

/**
 * The surf rock soundtrack. The order is shuffled once when the audio engine
 * starts and then repeats, so no two sessions open the same way but a single
 * session keeps a predictable running order.
 */
export const SOUNDTRACK = [
  "surfrock00",
  "surfrock01",
  "surfrock03",
  "surfrock04",
  "surfrock05",
  "surfrock06",
  "surfrock07",
  "surfrock08",
  "surfrock09",
  "surfrock10",
  "surfrock11",
  "surfrock12",
] as const;

const SOUNDTRACK_LEVEL = .58;

function shuffled<T>(values: readonly T[]) {
  const order = [...values];
  for (let index = order.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [order[index], order[swap]] = [order[swap], order[index]];
  }
  return order;
}

type CoastSoundProfile = {
  bedRate: number;
  bedFilter: BiquadFilterType;
  bedFrequency: number;
  bedQ: number;
  bedGain: number;
  windResponse: number;
  nightGain: number;
  cueBase: number;
  cueVariance: number;
};

const COAST_SOUND_PROFILES = {
  urban: {
    bedRate: .54,
    bedFilter: "lowpass",
    bedFrequency: 245,
    bedQ: .82,
    bedGain: .018,
    windResponse: .16,
    nightGain: .72,
    cueBase: 9,
    cueVariance: 9,
  },
  tropical: {
    bedRate: 1.18,
    bedFilter: "bandpass",
    bedFrequency: 4100,
    bedQ: .36,
    bedGain: .0065,
    windResponse: .46,
    nightGain: 1.42,
    cueBase: 8,
    cueVariance: 10,
  },
  dune: {
    bedRate: .86,
    bedFilter: "bandpass",
    bedFrequency: 1580,
    bedQ: .48,
    bedGain: .011,
    windResponse: .72,
    nightGain: .66,
    cueBase: 11,
    cueVariance: 12,
  },
  rugged: {
    bedRate: .48,
    bedFilter: "bandpass",
    bedFrequency: 390,
    bedQ: 1.12,
    bedGain: .017,
    windResponse: 1,
    nightGain: .82,
    cueBase: 12,
    cueVariance: 10,
  },
  cold: {
    bedRate: .64,
    bedFilter: "bandpass",
    bedFrequency: 620,
    bedQ: .72,
    bedGain: .013,
    windResponse: .86,
    nightGain: .7,
    cueBase: 13,
    cueVariance: 13,
  },
  volcanic: {
    bedRate: .78,
    bedFilter: "bandpass",
    bedFrequency: 980,
    bedQ: .56,
    bedGain: .011,
    windResponse: .66,
    nightGain: .74,
    cueBase: 10,
    cueVariance: 11,
  },
  desert: {
    bedRate: .95,
    bedFilter: "highpass",
    bedFrequency: 2100,
    bedQ: .34,
    bedGain: .0075,
    windResponse: .92,
    nightGain: .52,
    cueBase: 12,
    cueVariance: 14,
  },
} satisfies Record<CoastBiome, CoastSoundProfile>;

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
  private submersionFilter: BiquadFilterNode | null = null;
  private reverb: ConvolverNode | null = null;
  private reverbGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private worldGain: GainNode | null = null;
  private worldFilter: BiquadFilterNode | null = null;

  private oceanGain: GainNode | null = null;
  private oceanFilter: BiquadFilterNode | null = null;
  private oceanPanner: StereoPannerNode | null = null;
  private undertowGain: GainNode | null = null;
  private undertowPanner: StereoPannerNode | null = null;
  private foamGain: GainNode | null = null;
  private foamPanner: StereoPannerNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private windPanner: StereoPannerNode | null = null;
  private rainGain: GainNode | null = null;
  private rainFilter: BiquadFilterNode | null = null;
  private coastBed: AudioBufferSourceNode | null = null;
  private coastBedGain: GainNode | null = null;
  private coastBedFilter: BiquadFilterNode | null = null;
  private coastBedPanner: StereoPannerNode | null = null;
  private coastBiome: CoastBiome = "dune";
  private coastLandwardPan = 0;
  private nextCoastCueAt = 0;

  private surf: AudioBufferSourceNode | null = null;
  private surfGain: GainNode | null = null;
  private surfFilter: BiquadFilterNode | null = null;
  private surfPanner: StereoPannerNode | null = null;
  private barrelRoar: AudioBufferSourceNode | null = null;
  private barrelRoarGain: GainNode | null = null;
  private barrelRoarFilter: BiquadFilterNode | null = null;
  private barrelRoarPanner: StereoPannerNode | null = null;

  private breaker: AudioBufferSourceNode | null = null;
  private breakerRumbleGain: GainNode | null = null;
  private breakerRumbleFilter: BiquadFilterNode | null = null;
  private breakerWashGain: GainNode | null = null;
  private breakerWashFilter: BiquadFilterNode | null = null;
  private breakerPanner: PannerNode | null = null;
  private previousSetEnergy = 0;
  private nextSetBreathAt = 0;

  private musicBus: GainNode | null = null;
  private soundtrack: HTMLAudioElement | null = null;
  private soundtrackGain: GainNode | null = null;
  private soundtrackOrder: string[] = [];
  private soundtrackIndex = 0;
  private musicEnabled = true;

  private engine: OscillatorNode[] = [];
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private roadGain: GainNode | null = null;
  private roadFilter: BiquadFilterNode | null = null;

  private nextFoleyAt = 0;
  private nextGullAt = 0;
  private nextAthleteBreathAt = 0;
  private nextHeartbeatAt = 0;
  private nextGaspAt = 0;
  private athleteWasSubmerged = false;
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
    if (context.listener.positionX && context.listener.forwardX && context.listener.upX) {
      context.listener.positionX.value = 0;
      context.listener.positionY.value = 0;
      context.listener.positionZ.value = 0;
      context.listener.forwardX.value = 0;
      context.listener.forwardY.value = 0;
      context.listener.forwardZ.value = -1;
      context.listener.upX.value = 0;
      context.listener.upY.value = 1;
      context.listener.upZ.value = 0;
    } else {
      context.listener.setPosition(0, 0, 0);
      context.listener.setOrientation(0, 0, -1, 0, 1, 0);
    }

    const master = context.createGain();
    const compressor = context.createDynamicsCompressor();
    const submersionFilter = context.createBiquadFilter();
    master.gain.value = this.enabled ? .42 : 0;
    compressor.threshold.value = -17;
    compressor.knee.value = 19;
    compressor.ratio.value = 3.2;
    compressor.attack.value = .008;
    compressor.release.value = .32;
    submersionFilter.type = "lowpass";
    submersionFilter.frequency.value = 18000;
    submersionFilter.Q.value = .42;
    master.connect(compressor).connect(submersionFilter).connect(context.destination);
    this.master = master;
    this.submersionFilter = submersionFilter;

    const reverb = context.createConvolver();
    const reverbGain = context.createGain();
    reverb.buffer = this.createImpulse(context, 1.65, 2.65);
    reverbGain.gain.value = .18;
    reverb.connect(reverbGain).connect(master);
    this.reverb = reverb;
    this.reverbGain = reverbGain;

    const worldGain = context.createGain();
    const worldFilter = context.createBiquadFilter();
    worldGain.gain.value = 1;
    worldFilter.type = "lowpass";
    worldFilter.frequency.value = 18000;
    worldFilter.Q.value = .48;
    worldGain.connect(worldFilter).connect(master);
    this.sendToReverb(worldFilter, .075);
    this.worldGain = worldGain;
    this.worldFilter = worldFilter;

    const ocean = this.loopNoise(.72, 0.31);
    const oceanFilter = context.createBiquadFilter();
    const oceanGain = context.createGain();
    const oceanPanner = context.createStereoPanner();
    oceanFilter.type = "lowpass";
    oceanFilter.frequency.value = 720;
    oceanFilter.Q.value = .55;
    oceanGain.gain.value = .24;
    ocean.connect(oceanFilter).connect(oceanGain).connect(oceanPanner).connect(worldGain);
    this.oceanFilter = oceanFilter;
    this.oceanGain = oceanGain;
    this.oceanPanner = oceanPanner;

    const undertow = this.loopNoise(.51, 2.18);
    const undertowFilter = context.createBiquadFilter();
    const undertowGain = context.createGain();
    const undertowPanner = context.createStereoPanner();
    undertowFilter.type = "lowpass";
    undertowFilter.frequency.value = 185;
    undertowFilter.Q.value = 1.1;
    undertowGain.gain.value = .065;
    undertow.connect(undertowFilter).connect(undertowGain).connect(undertowPanner).connect(worldGain);
    this.undertowGain = undertowGain;
    this.undertowPanner = undertowPanner;

    const foam = this.loopNoise(1.34, 4.06);
    const foamFilter = context.createBiquadFilter();
    const foamGain = context.createGain();
    const foamPanner = context.createStereoPanner();
    foamFilter.type = "highpass";
    foamFilter.frequency.value = 2750;
    foamGain.gain.value = .022;
    foam.connect(foamFilter).connect(foamGain).connect(foamPanner).connect(worldGain);
    this.foamGain = foamGain;
    this.foamPanner = foamPanner;

    const wind = this.loopNoise(.87, 1.24);
    const windFilter = context.createBiquadFilter();
    const windGain = context.createGain();
    const windPanner = context.createStereoPanner();
    windFilter.type = "bandpass";
    windFilter.frequency.value = 1280;
    windFilter.Q.value = .46;
    windGain.gain.value = .012;
    wind.connect(windFilter).connect(windGain).connect(windPanner).connect(worldGain);
    this.windFilter = windFilter;
    this.windGain = windGain;
    this.windPanner = windPanner;

    const rain = this.loopNoise(1.72, 5.74);
    const rainFilter = context.createBiquadFilter();
    const rainGain = context.createGain();
    rainFilter.type = "bandpass";
    rainFilter.frequency.value = 2850;
    rainFilter.Q.value = .42;
    rainGain.gain.value = 0;
    rain.connect(rainFilter).connect(rainGain).connect(worldGain);
    this.rainFilter = rainFilter;
    this.rainGain = rainGain;

    const coastBed = this.loopNoise(COAST_SOUND_PROFILES.dune.bedRate, 6.32);
    const coastBedFilter = context.createBiquadFilter();
    const coastBedGain = context.createGain();
    const coastBedPanner = context.createStereoPanner();
    coastBedFilter.type = COAST_SOUND_PROFILES.dune.bedFilter;
    coastBedFilter.frequency.value = COAST_SOUND_PROFILES.dune.bedFrequency;
    coastBedFilter.Q.value = COAST_SOUND_PROFILES.dune.bedQ;
    coastBedGain.gain.value = 0;
    coastBed.connect(coastBedFilter).connect(coastBedGain).connect(coastBedPanner).connect(worldGain);
    this.coastBed = coastBed;
    this.coastBedFilter = coastBedFilter;
    this.coastBedGain = coastBedGain;
    this.coastBedPanner = coastBedPanner;

    const surf = this.loopNoise(1.16, 3.12);
    const surfFilter = context.createBiquadFilter();
    const surfGain = context.createGain();
    const surfPanner = context.createStereoPanner();
    surfFilter.type = "highpass";
    surfFilter.frequency.value = 980;
    surfFilter.Q.value = .65;
    surfGain.gain.value = 0;
    surf.connect(surfFilter).connect(surfPanner).connect(surfGain).connect(master);
    this.sendToReverb(surfGain, .08);
    this.surf = surf;
    this.surfFilter = surfFilter;
    this.surfGain = surfGain;
    this.surfPanner = surfPanner;

    const barrelRoar = this.loopNoise(.58, 1.86);
    const barrelRoarFilter = context.createBiquadFilter();
    const barrelRoarGain = context.createGain();
    const barrelRoarPanner = context.createStereoPanner();
    barrelRoarFilter.type = "bandpass";
    barrelRoarFilter.frequency.value = 360;
    barrelRoarFilter.Q.value = 1.28;
    barrelRoarGain.gain.value = 0;
    barrelRoar.connect(barrelRoarFilter).connect(barrelRoarGain).connect(barrelRoarPanner).connect(master);
    this.sendToReverb(barrelRoarPanner, .24);
    this.barrelRoar = barrelRoar;
    this.barrelRoarGain = barrelRoarGain;
    this.barrelRoarFilter = barrelRoarFilter;
    this.barrelRoarPanner = barrelRoarPanner;

    const breaker = this.loopNoise(.74, 5.42);
    const breakerRumbleFilter = context.createBiquadFilter();
    const breakerRumbleGain = context.createGain();
    const breakerWashFilter = context.createBiquadFilter();
    const breakerWashGain = context.createGain();
    const breakerPanner = context.createPanner();
    breakerPanner.panningModel = "HRTF";
    breakerPanner.distanceModel = "linear";
    breakerPanner.refDistance = 1;
    breakerPanner.maxDistance = 14;
    breakerPanner.rolloffFactor = .22;
    if (breakerPanner.positionX) {
      breakerPanner.positionX.value = 0;
      breakerPanner.positionY.value = .2;
      breakerPanner.positionZ.value = -3;
    } else {
      breakerPanner.setPosition(0, .2, -3);
    }
    breakerRumbleFilter.type = "lowpass";
    breakerRumbleFilter.frequency.value = 310;
    breakerRumbleFilter.Q.value = 1.2;
    breakerRumbleGain.gain.value = 0;
    breakerWashFilter.type = "bandpass";
    breakerWashFilter.frequency.value = 1260;
    breakerWashFilter.Q.value = .58;
    breakerWashGain.gain.value = 0;
    breaker.connect(breakerRumbleFilter).connect(breakerRumbleGain).connect(breakerPanner);
    breaker.connect(breakerWashFilter).connect(breakerWashGain).connect(breakerPanner);
    breakerPanner.connect(worldGain);
    this.breaker = breaker;
    this.breakerRumbleGain = breakerRumbleGain;
    this.breakerRumbleFilter = breakerRumbleFilter;
    this.breakerWashGain = breakerWashGain;
    this.breakerWashFilter = breakerWashFilter;
    this.breakerPanner = breakerPanner;

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

    this.createSoundtrack();
    this.createEngine();
    this.nextGullAt = context.currentTime + 5 + Math.random() * 5;
    this.nextSetBreathAt = context.currentTime + 1.2;
    this.nextAthleteBreathAt = context.currentTime + 1.4;
    this.nextHeartbeatAt = context.currentTime + .8;
    this.nextGaspAt = context.currentTime + .5;
    this.nextCoastCueAt = context.currentTime + 3.2;
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!this.context || !this.master) return;
    ramp(this.master.gain, enabled ? .42 : 0, this.context.currentTime, .18);
    this.syncSoundtrackPlayback();
  }

  setMusicEnabled(enabled: boolean) {
    this.musicEnabled = enabled;
    if (!this.context || !this.musicBus) return;
    ramp(this.musicBus.gain, enabled ? 1 : 0, this.context.currentTime, .32);
    this.syncSoundtrackPlayback();
  }

  /** One-based position in the running order, for anything that names the track. */
  currentTrack() {
    return {
      index: this.soundtrackIndex + 1,
      total: this.soundtrackOrder.length || SOUNDTRACK.length,
    };
  }

  /** Notified whenever the running order moves on, so the UI can name the track. */
  onTrackChange: ((track: { index: number; total: number }) => void) | null = null;

  setAcousticSpace(phase: GamePhase, barrel: number, active: boolean) {
    if (!this.context || !this.worldGain || !this.worldFilter) return;
    const now = this.context.currentTime;
    const cabin = active && phase === "driving" ? 1 : 0;
    const tube = active && phase === "riding"
      ? Math.min(1, Math.max(0, barrel))
      : 0;
    const worldLevel = cabin
      ? .38
      : 1 - tube * .08;
    const cutoff = cabin
      ? 1480
      : 18000 * Math.pow(.23, tube);
    ramp(this.worldGain.gain, worldLevel, now, cabin ? .2 : .42);
    ramp(this.worldFilter.frequency, cutoff, now, cabin ? .18 : tube > .08 ? .24 : .55);
    ramp(this.worldFilter.Q, .48 + cabin * .34 + tube * 1.42, now, .3);
    if (this.musicBus) {
      const scoreSpace = this.musicEnabled
        ? active
          ? 1 - tube * .48 - cabin * .12
          : .58
        : 0;
      ramp(this.musicBus.gain, scoreSpace, now, tube > .08 ? .28 : .46);
    }
  }

  setSubmersion(amount: number, turbulence = 0, breath = 100) {
    if (!this.context || !this.submersionFilter) return;
    const now = this.context.currentTime;
    const depth = Math.min(1, Math.max(0, amount));
    const force = Math.min(1, Math.max(0, turbulence));
    const breathStress = 1 - Math.min(100, Math.max(0, breath)) / 100;
    const cutoff = 18000 * Math.pow(.042, depth) * (1 - force * depth * .2 - breathStress * depth * .08);
    ramp(this.submersionFilter.frequency, Math.max(620, cutoff), now, depth > .05 ? .12 : .34);
    ramp(this.submersionFilter.Q, .42 + depth * (1.35 + force * .48), now, .16);
    if (this.reverbGain) ramp(this.reverbGain.gain, .18 + depth * (.27 + force * .09), now, depth > .05 ? .16 : .5);
  }

  setPerspective(
    cameraHeading: number,
    windDirection: number,
    coastHeading: number,
    phase: GamePhase,
  ) {
    if (!this.context) return;
    const now = this.context.currentTime;
    const relativeBearing = (sourceHeading: number) => Math.atan2(
      Math.sin(sourceHeading - cameraHeading),
      Math.cos(sourceHeading - cameraHeading),
    );
    const offshoreBearing = relativeBearing(Math.PI);
    const windBearing = relativeBearing((windDirection - coastHeading) * Math.PI / 180);
    const surrounded = phase === "paddling" || phase === "riding" || phase === "wipeout";
    const oceanDirectionality = surrounded ? .58 : 1;
    if (this.oceanPanner) {
      ramp(this.oceanPanner.pan, Math.sin(offshoreBearing) * .31 * oceanDirectionality, now, .18);
    }
    if (this.undertowPanner) {
      ramp(this.undertowPanner.pan, Math.sin(offshoreBearing) * .2 * oceanDirectionality, now, .2);
    }
    if (this.foamPanner) {
      ramp(this.foamPanner.pan, Math.sin(offshoreBearing) * .43 * oceanDirectionality, now, .16);
    }
    if (this.windPanner) {
      ramp(this.windPanner.pan, Math.sin(windBearing) * .5, now, .2);
    }
    if (this.coastBedPanner) {
      const landwardBearing = relativeBearing(0);
      this.coastLandwardPan = Math.sin(landwardBearing) * .56;
      ramp(this.coastBedPanner.pan, this.coastLandwardPan, now, .24);
    }
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

  setCoastSoundscape(
    biome: CoastBiome,
    phase: GamePhase,
    offshoreDistance: number,
    windSpeed: number,
    timeOfDay: number,
    weatherCode: number,
    active: boolean,
  ) {
    if (!this.context) return;
    const now = this.context.currentTime;
    const profile = COAST_SOUND_PROFILES[biome];
    const biomeChanged = biome !== this.coastBiome;
    this.coastBiome = biome;
    if (biomeChanged) this.nextCoastCueAt = now + 2.4 + Math.random() * 2.8;

    const wind = Math.min(1.35, Math.max(0, windSpeed) / 24);
    const rain = precipitationLevel(weatherCode);
    const night = timeOfDay < 6 || timeOfDay > 19.25;
    const distance = Math.max(0, offshoreDistance);
    const shoreProximity = 1 - Math.min(1, Math.max(0, (distance - 8) / 260));
    const phasePresence = phase === "driving" || phase === "shore"
      ? 1
      : phase === "wading"
        ? .86
        : phase === "paddling"
          ? .58
          : phase === "riding"
            ? .34
            : .2;
    const weatherPresence = 1 - rain * .42;
    const targetGain = active
      ? profile.bedGain
        * shoreProximity
        * phasePresence
        * weatherPresence
        * (night ? profile.nightGain : 1)
        * (.7 + wind * profile.windResponse)
      : 0;

    if (this.coastBedGain) ramp(this.coastBedGain.gain, targetGain, now, biomeChanged ? .9 : .52);
    if (this.coastBedFilter) {
      this.coastBedFilter.type = profile.bedFilter;
      ramp(
        this.coastBedFilter.frequency,
        profile.bedFrequency * (.9 + wind * .28) * (night ? .92 : 1),
        now,
        biomeChanged ? .82 : .7,
      );
      ramp(this.coastBedFilter.Q, profile.bedQ + wind * .12, now, .7);
    }
    if (this.coastBed) {
      ramp(this.coastBed.playbackRate, profile.bedRate * (.94 + wind * .12), now, biomeChanged ? .84 : .65);
    }

    const cueAllowed = this.enabled
      && active
      && shoreProximity > .28
      && rain < .55
      && phase !== "riding"
      && phase !== "wipeout";
    if (!cueAllowed) {
      this.nextCoastCueAt = Math.max(this.nextCoastCueAt, now + .9);
      return;
    }
    if (now < this.nextCoastCueAt) return;

    const cueIntensity = shoreProximity * phasePresence * (1 - rain * .55);
    this.coastCue(now, biome, wind, night, cueIntensity);
    const weatherSpacing = 1 + wind * .18 + rain * .5;
    this.nextCoastCueAt = now
      + (profile.cueBase + Math.random() * profile.cueVariance) * weatherSpacing;
  }

  setVehicle(speed: number, active: boolean, throttle = 0, offRoad = 0, slip = 0, braking = false) {
    if (!this.context || !this.engineGain || !this.engineFilter || !this.roadGain) return;
    const now = this.context.currentTime;
    const revs = Math.min(1, Math.abs(speed) / 19);
    const gear = Math.min(3, Math.floor(Math.abs(speed) / 5.3));
    const load = Math.min(1, Math.abs(throttle));
    const loose = Math.min(1, Math.max(offRoad, slip * .82));
    ramp(this.engineGain.gain, active && this.enabled ? .015 + revs * .052 + load * .033 + (braking ? .008 : 0) : 0, now, .085);
    ramp(this.roadGain.gain, active && this.enabled ? .004 + Math.pow(revs, 1.3) * .062 + loose * (.018 + revs * .045) : 0, now, .09);
    ramp(this.engineFilter.frequency, 250 + revs * 610 + gear * 64 + load * 260, now, .085);
    if (this.roadFilter) {
      ramp(this.roadFilter.frequency, 205 + revs * 310 + offRoad * 620 + slip * 460, now, .11);
      ramp(this.roadFilter.Q, .64 + offRoad * .45 + slip * .52, now, .12);
    }
    this.engine.forEach((oscillator, index) => {
      const base = [43, 86, 129][index] ?? 43;
      ramp(oscillator.frequency, base + revs * base * .82 + load * base * .2 - gear * 3.8, now, .085);
    });
  }

  setSurf(
    speed: number,
    active: boolean,
    setEnergy: number,
    barrel: number,
    railLoad = 0,
    railGrip = 1,
    trickCharge = 0,
    facePosition = 0,
    acceleration = 0,
    lateralForce = 0,
    whitewater = 0,
  ) {
    if (!this.context || !this.surfGain || !this.surfFilter || !this.surf) return;
    const now = this.context.currentTime;
    const velocity = Math.min(1, Math.max(0, speed - 4.5) / 13);
    const rail = Math.min(1, Math.abs(railLoad));
    const release = 1 - Math.min(1, Math.max(0, railGrip));
    const loaded = Math.min(1, Math.max(0, trickCharge));
    const lip = Math.max(0, Math.min(1, facePosition));
    const bottom = Math.max(0, Math.min(1, -facePosition));
    const drive = Math.max(0, Math.min(1, acceleration));
    const deceleration = Math.max(0, Math.min(1, -acceleration));
    const cornerLoad = Math.min(1, Math.abs(lateralForce));
    const foamLoad = Math.min(1, Math.max(0, whitewater));
    const cavitation = velocity * Math.min(1, rail * .34 + release * .76 + cornerLoad * .48);
    const targetGain = active && this.enabled
      ? .016 + velocity * .12 + barrel * .068 + setEnergy * .02 + rail * .032 + release * .052 + loaded * .016 + lip * .018 + bottom * .008 + drive * .018 + cornerLoad * .026 + deceleration * .01 + cavitation * .028 + foamLoad * .065
      : 0;
    ramp(this.surfGain.gain, targetGain, now, .12);
    ramp(this.surfFilter.frequency, 820 + velocity * 1420 + barrel * 520 + rail * 620 + release * 940 + lip * 680 - bottom * 120 + drive * 260 + cornerLoad * 410 - deceleration * 90 + cavitation * 1180 - foamLoad * 360, now, .1);
    ramp(this.surfFilter.Q, .62 + rail * .72 + loaded * .34 + lip * .18 + cornerLoad * .25 + cavitation * .42 + foamLoad * .16, now, .12);
    ramp(this.surf.playbackRate, 1.0 + velocity * .34 + barrel * .1 + release * .12 + lip * .06 - bottom * .025 + drive * .035 + cornerLoad * .025 + cavitation * .065 - foamLoad * .04, now, .1);
    if (this.surfPanner) ramp(this.surfPanner.pan, Math.max(-.72, Math.min(.72, railLoad * .57 + lateralForce * .24)), now, .1);
    if (this.barrelRoar && this.barrelRoarGain && this.barrelRoarFilter) {
      const enclosure = active ? Math.pow(Math.min(1, Math.max(0, barrel)), 1.18) : 0;
      const tubePressure = enclosure * (.62 + setEnergy * .26 + velocity * .24);
      ramp(this.barrelRoarGain.gain, tubePressure * .115, now, tubePressure > this.barrelRoarGain.gain.value ? .16 : .38);
      ramp(this.barrelRoarFilter.frequency, 285 + enclosure * 260 + velocity * 190 + setEnergy * 85, now, .2);
      ramp(this.barrelRoarFilter.Q, 1.18 + enclosure * 2.05 + setEnergy * .34, now, .24);
      ramp(this.barrelRoar.playbackRate, .82 + enclosure * .24 + velocity * .13 + setEnergy * .08, now, .2);
      if (this.barrelRoarPanner) {
        ramp(this.barrelRoarPanner.pan, Math.max(-.28, Math.min(.28, -railLoad * .14 - lateralForce * .08)), now, .16);
      }
    }
  }

  setWaveField(
    phase: GamePhase,
    setEnergy: number,
    shorebreakIntensity: number,
    takeoffOpportunity: number,
    lineSide: number,
    sectionPressure: number,
    waveHeight: number,
    wavePeriod: number,
    waveDirection: number,
    swellHeight: number,
    swellPeriod: number,
    swellDirection: number,
    active: boolean,
    cameraHeading = 0,
  ) {
    if (
      !this.context
      || !this.breaker
      || !this.breakerRumbleGain
      || !this.breakerRumbleFilter
      || !this.breakerWashGain
      || !this.breakerWashFilter
      || !this.breakerPanner
    ) return;
    const now = this.context.currentTime;
    const energy = Math.min(1, Math.max(0, setEnergy));
    const shorebreak = Math.min(1, Math.max(0, shorebreakIntensity));
    const takeoff = Math.min(
      1,
      Math.max(0, takeoffOpportunity),
    );
    const pressure = Math.min(1, Math.max(0, sectionPressure));
    const face = Math.min(1.45, Math.max(.12, waveHeight) / 2.4);
    const swell = Math.min(1.45, Math.max(0, swellHeight) / 2.4);
    const crossingAngle = Math.abs(Math.sin((swellDirection - waveDirection) * Math.PI / 180));
    const crossingPresence = swell * (.22 + crossingAngle * .78);
    const waveFrequency = 1 / Math.max(4, wavePeriod);
    const swellFrequency = 1 / Math.max(4, swellPeriod);
    const crossingBeat = .5 + Math.sin(now * Math.PI * 2 * Math.abs(waveFrequency - swellFrequency)) * .5;
    const phasePresence = phase === "shore"
      ? .58
      : phase === "wading"
        ? .76
        : phase === "paddling"
          ? .9
          : 1;
    const risingSet = Math.pow(energy, .72);
    const audible = active && this.enabled;
    const rumbleLevel = audible
      ? (.006 + risingSet * .047 + shorebreak * .072 + takeoff * .016 + pressure * .026)
        * (.68 + face * .32)
        * phasePresence
        + crossingPresence * (.004 + crossingBeat * .008) * phasePresence
      : 0;
    const washLevel = audible
      ? (.005 + risingSet * .038 + shorebreak * .086 + takeoff * .021 + pressure * .038)
        * (.64 + face * .36)
        * phasePresence
        + crossingPresence * (.003 + (1 - crossingBeat) * .006) * phasePresence
      : 0;
    const sourceHeading = phase === "riding"
      ? Math.sign(lineSide || 1) * Math.PI / 2
      : Math.PI;
    const sourceBearing = Math.atan2(
      Math.sin(sourceHeading - cameraHeading),
      Math.cos(sourceHeading - cameraHeading),
    );
    const shoulderPan = Math.sin(sourceBearing)
      * (phase === "riding" ? .3 + pressure * .52 : .12 + takeoff * .18 + risingSet * .1);
    const sourceDistance = phase === "riding"
      ? 2.15 + (1 - pressure) * 1.2
      : phase === "paddling"
        ? 3.1 + (1 - Math.max(shorebreak, energy)) * 1.8
        : 4.4 + (1 - energy) * 1.4;
    const cadence = Math.min(1.15, Math.max(.64, 9.5 / Math.max(5, wavePeriod)));

    ramp(this.breakerRumbleGain.gain, rumbleLevel, now, rumbleLevel > this.breakerRumbleGain.gain.value ? .24 : .7);
    ramp(this.breakerWashGain.gain, washLevel, now, washLevel > this.breakerWashGain.gain.value ? .2 : .58);
    ramp(this.breakerRumbleFilter.frequency, 205 + risingSet * 280 + shorebreak * 190 + face * 115 + crossingPresence * crossingBeat * 72, now, .45);
    ramp(this.breakerRumbleFilter.Q, .82 + risingSet * .68 + pressure * .3 + crossingPresence * .18, now, .45);
    ramp(this.breakerWashFilter.frequency, 920 + risingSet * 940 + shorebreak * 720 + pressure * 610 + crossingPresence * (1 - crossingBeat) * 180, now, .38);
    ramp(this.breakerWashFilter.Q, .5 + shorebreak * .34 + pressure * .42, now, .4);
    const sourceX = Math.sin(sourceBearing) * sourceDistance;
    const sourceY = .18 + face * .14;
    const sourceZ = -Math.cos(sourceBearing) * sourceDistance;
    if (this.breakerPanner.positionX) {
      ramp(this.breakerPanner.positionX, sourceX, now, .18);
      ramp(this.breakerPanner.positionY, sourceY, now, .28);
      ramp(this.breakerPanner.positionZ, sourceZ, now, .18);
    } else {
      this.breakerPanner.setPosition(sourceX, sourceY, sourceZ);
    }
    ramp(this.breaker.playbackRate, cadence + face * .08 + shorebreak * .1, now, .6);

    if (audible && energy >= .72 && this.previousSetEnergy < .72 && now >= this.nextSetBreathAt) {
      this.setBreath(now, .5 + energy * .5, shoulderPan);
      this.nextSetBreathAt = now + Math.max(5.5, wavePeriod * .48);
    }
    this.previousSetEnergy = energy;
  }

  /**
   * The soundtrack plays continuously; this only decides how loud it sits
   * under the surf. It lifts while riding or driving and steps back on the
   * beach and in the setup screen so the ocean stays legible.
   */
  setScore(
    phase: GamePhase,
    setEnergy: number,
    barrel: number,
    _timeOfDay: number,
    _weatherCode: number,
    active: boolean,
  ) {
    if (!this.context || !this.soundtrackGain) return;
    const now = this.context.currentTime;
    const riding = phase === "riding";
    const driving = phase === "driving";
    const paddling = phase === "paddling" || phase === "wading";
    const intensity = riding
      ? .9 + setEnergy * .1 + barrel * .1
      : driving
        ? .84
        : paddling
          ? .7 + setEnergy * .08
          : .58;
    ramp(
      this.soundtrackGain.gain,
      SOUNDTRACK_LEVEL * (active ? intensity : .72),
      now,
      .65,
    );
    this.syncSoundtrackPlayback();
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

  setAthlete(
    phase: GamePhase,
    paddleEffort: number,
    stamina: number,
    submersion: number,
    breath: number,
    speed: number,
    active: boolean,
  ) {
    if (!this.context) return;
    const now = this.context.currentTime;
    const depth = Math.min(1, Math.max(0, submersion));
    const effort = Math.min(1, Math.max(0, paddleEffort));
    const fatigue = 1 - Math.min(100, Math.max(0, stamina)) / 100;
    const breathStress = 1 - Math.min(100, Math.max(0, breath)) / 100;
    const pace = Math.min(1, Math.max(0, speed) / 16);

    if (!this.enabled || !active) {
      this.athleteWasSubmerged = depth > .34;
      this.nextAthleteBreathAt = now + .28;
      this.nextHeartbeatAt = now + .28;
      return;
    }

    if (depth > .34) this.athleteWasSubmerged = true;
    const resurfaced = this.athleteWasSubmerged && depth < .11;
    if (resurfaced) this.athleteWasSubmerged = false;

    const paddling = phase === "paddling";
    const riding = phase === "riding";
    const running = phase === "shore" && speed > 4.15;
    const heldUnder = phase === "wipeout" && depth > .24;
    const exertion = Math.min(
      1,
      paddling
        ? .12 + effort * .67 + fatigue * .32
        : riding
          ? .08 + fatigue * .54 + pace * .18
          : running
            ? .3 + pace * .34 + fatigue * .28
            : phase === "wading"
              ? .08 + pace * .2 + fatigue * .16
              : fatigue * .08,
    );

    if (resurfaced && breathStress > .08 && now >= this.nextGaspAt) {
      this.athleteBreath(now, Math.min(1, .48 + breathStress * .72), 0, true);
      this.nextGaspAt = now + 2.4;
      this.nextAthleteBreathAt = now + .72;
    }

    if (!heldUnder && depth < .18 && exertion > .17 && now >= this.nextAthleteBreathAt) {
      const shoulderPan = paddling ? this.foleySide * .12 : 0;
      this.athleteBreath(now, exertion, shoulderPan, false);
      const baseInterval = paddling
        ? 1.72 - effort * .72
        : running
          ? 1.68 - pace * .48
          : 2.55 - exertion * .92;
      this.nextAthleteBreathAt = now + Math.max(.74, baseInterval) * (.93 + Math.random() * .14);
    }

    const holdStress = heldUnder
      ? Math.min(1, .16 + breathStress * .72 + depth * .18)
      : 0;
    if (holdStress > .28 && now >= this.nextHeartbeatAt) {
      this.athleteHeartbeat(now, holdStress);
      this.nextHeartbeatAt = now + Math.max(.48, .96 - holdStress * .4);
    } else if (!heldUnder) {
      this.nextHeartbeatAt = Math.max(this.nextHeartbeatAt, now + .24);
    }
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
    } else if (kind === "leash") {
      this.noiseBurst(now, .19, 2480, 1.25, .072, "bandpass", this.foleySide * .28, .025);
      this.tone(now, 168, 74, .2, .036, "triangle", this.foleySide * .18, .045);
      this.noiseBurst(now + .045, .25, 920, .72, .055, "lowpass", -this.foleySide * .16, .03);
    } else if (kind === "wipeout") {
      this.noiseBurst(now, 1.25, 470, .62, .3, "bandpass", 0, .16);
      this.noiseBurst(now + .04, .72, 2100, .5, .13, "highpass", -.2, .09);
      this.tone(now, 78, 38, .78, .12, "sine", 0, .14);
    } else if (kind === "door") {
      this.noiseBurst(now, .14, 690, .78, .065, "bandpass", -.34, .02);
      this.tone(now + .015, 132, 74, .18, .042, "triangle", -.28, .055);
      this.noiseBurst(now + 1.82, .11, 520, .82, .075, "lowpass", -.36, .025);
      this.tone(now + 1.85, 86, 52, .16, .052, "triangle", -.3, .08);
      this.noiseBurst(now + 1.9, .07, 1540, .9, .026, "bandpass", -.3, .01);
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

  private createSoundtrack() {
    const context = this.context!;
    const soundtrackGain = context.createGain();
    soundtrackGain.gain.value = SOUNDTRACK_LEVEL * .72;
    soundtrackGain.connect(this.musicBus!);
    this.soundtrackGain = soundtrackGain;
    this.soundtrackOrder = shuffled(SOUNDTRACK);
    this.soundtrackIndex = 0;

    // A media element streams each track instead of decoding the whole
    // soundtrack into memory, and routing it through the music bus keeps it
    // under the same mute, barrel ducking, and van cabin filtering as before.
    const element = new Audio();
    element.preload = "auto";
    element.loop = false;
    element.crossOrigin = "anonymous";
    element.addEventListener("ended", () => this.advanceTrack());
    // A track that will not load must not take the rest of the running order
    // with it.
    element.addEventListener("error", () => {
      if (this.soundtrackOrder.length > 1) this.advanceTrack();
    });
    context.createMediaElementSource(element).connect(soundtrackGain);
    this.soundtrack = element;
    this.loadTrack();
  }

  private loadTrack() {
    const element = this.soundtrack;
    const track = this.soundtrackOrder[this.soundtrackIndex];
    if (!element || !track) return;
    element.src = `/audio/${track}.mp3`;
    this.onTrackChange?.(this.currentTrack());
    this.syncSoundtrackPlayback();
  }

  /** Wrap back to the top of the same shuffle rather than reshuffling. */
  private advanceTrack() {
    if (this.soundtrackOrder.length === 0) return;
    this.soundtrackIndex = (this.soundtrackIndex + 1) % this.soundtrackOrder.length;
    this.loadTrack();
  }

  private syncSoundtrackPlayback() {
    const element = this.soundtrack;
    if (!element) return;
    if (this.enabled && this.musicEnabled) {
      // Autoplay is only ever reached from the gesture that started the audio
      // context, but a rejected promise must not surface as an unhandled error.
      void element.play().catch(() => {});
    } else if (!element.paused) {
      element.pause();
    }
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
    this.roadFilter = roadFilter;
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

  private coastCue(
    now: number,
    biome: CoastBiome,
    wind: number,
    night: boolean,
    intensity: number,
  ) {
    const presence = Math.min(1, Math.max(.08, intensity));
    const cuePan = Math.max(
      -.86,
      Math.min(.86, this.coastLandwardPan * 1.34 + (Math.random() - .5) * .28),
    );
    const alongshoreTravel = Math.random() < .5 ? -.24 : .24;
    if (biome === "urban") {
      this.coastNoiseSweep(
        now,
        1.35 + wind * .45,
        220 + wind * 150,
        .72,
        (.008 + presence * .012) * (night ? .72 : 1),
        "bandpass",
        cuePan + alongshoreTravel,
        cuePan - alongshoreTravel,
        .58 + wind * .16,
      );
      if (!night && Math.random() > .68) {
        this.coastTone(now + .48, 238, 224, .22, .0024 * presence, "sine", cuePan * .72);
      }
      return;
    }
    if (biome === "tropical") {
      if (night) {
        for (let pulse = 0; pulse < 4; pulse += 1) {
          this.coastTone(
            now + pulse * .12,
            2780 + pulse * 120,
            3180 + pulse * 145,
            .07,
            (.0017 + presence * .0022) * (1 - pulse * .1),
            "sine",
            cuePan * (1 - pulse * .06),
          );
        }
      } else {
        this.coastTone(now, 1820, 2580, .2, .0038 * presence, "sine", cuePan);
        this.coastTone(now + .24, 2380, 1960, .24, .0032 * presence, "sine", cuePan * .92);
        this.coastNoiseSweep(now + .04, .52, 3750, .38, .003 * presence, "highpass", cuePan * .86, cuePan * .66, 1.22);
      }
      return;
    }
    if (biome === "dune") {
      this.coastNoiseSweep(
        now,
        .82 + wind * .4,
        1380 + wind * 520,
        .46,
        (.004 + wind * .006) * presence,
        "bandpass",
        cuePan,
        cuePan * .58,
        .9 + wind * .18,
      );
      if (!night) {
        this.coastTone(now + .16, 1540, 2240, .18, .0032 * presence, "sine", cuePan);
        this.coastTone(now + .42, 1880, 1460, .2, .0025 * presence, "sine", cuePan * .9);
      }
      return;
    }
    if (biome === "rugged") {
      this.coastNoiseSweep(
        now,
        1.7 + wind * .65,
        330 + wind * 310,
        1.14,
        (.009 + wind * .014) * presence,
        "bandpass",
        cuePan,
        cuePan * .36,
        .46 + wind * .12,
      );
      this.coastTone(now + .3, 104, 76, .82, .0038 * presence, "sine", cuePan * .62);
      return;
    }
    if (biome === "cold") {
      this.coastNoiseSweep(
        now,
        1.1 + wind * .5,
        560 + wind * 410,
        .74,
        (.006 + wind * .008) * presence,
        "bandpass",
        cuePan,
        cuePan * .52,
        .68 + wind * .12,
      );
      if (!night) {
        this.coastTone(now + .12, 780, 535, .38, .0035 * presence, "triangle", cuePan);
        this.coastTone(now + .52, 620, 470, .29, .0024 * presence, "triangle", cuePan * .9);
      }
      return;
    }
    if (biome === "volcanic") {
      this.coastNoiseSweep(now, .76, 930 + wind * 420, .58, .0048 * presence, "bandpass", cuePan, cuePan * .62, .8);
      if (!night) {
        this.coastTone(now + .06, 2120, 2140, .24, .0036 * presence, "sine", cuePan);
        this.coastTone(now + .32, 2660, 2580, .18, .003 * presence, "sine", cuePan * .92);
        this.coastTone(now + .57, 1810, 2320, .2, .0028 * presence, "sine", cuePan * .84);
      }
      return;
    }
    this.coastNoiseSweep(
      now,
      .48 + wind * .38,
      2450 + wind * 1450,
      .36,
      (.004 + wind * .007) * presence,
      "highpass",
      cuePan,
      cuePan * .42,
      1.08 + wind * .16,
    );
    if (!night) {
      this.coastTone(now + .1, 1340, 1840, .22, .0026 * presence, "sine", cuePan);
    }
  }

  private coastNoiseSweep(
    now: number,
    duration: number,
    frequency: number,
    q: number,
    gainValue: number,
    filterType: BiquadFilterType,
    fromPan: number,
    toPan: number,
    playbackRate: number,
  ) {
    if (!this.context || !this.noiseBuffer || !this.worldGain) return;
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    const panner = this.context.createStereoPanner();
    source.buffer = this.noiseBuffer;
    source.playbackRate.value = playbackRate;
    filter.type = filterType;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    panner.pan.setValueAtTime(Math.max(-1, Math.min(1, fromPan)), now);
    panner.pan.linearRampToValueAtTime(Math.max(-1, Math.min(1, toPan)), now + duration);
    gain.gain.setValueAtTime(.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(.0002, gainValue), now + Math.min(.18, duration * .22));
    gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
    source.connect(filter).connect(gain).connect(panner).connect(this.worldGain);
    const maxOffset = Math.max(0, this.noiseBuffer.duration - duration - .05);
    source.start(now, Math.random() * maxOffset, duration + .02);
    source.stop(now + duration + .04);
  }

  private coastTone(
    now: number,
    from: number,
    to: number,
    duration: number,
    gainValue: number,
    type: OscillatorType,
    pan: number,
  ) {
    if (!this.context || !this.worldGain) return;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const panner = this.context.createStereoPanner();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(Math.max(1, from), now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, to), now + duration);
    gain.gain.setValueAtTime(.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(.0002, gainValue), now + Math.min(.025, duration * .2));
    gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    oscillator.connect(gain).connect(panner).connect(this.worldGain);
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

  private athleteBreath(now: number, intensity: number, pan: number, gasp: boolean) {
    const strength = Math.min(1, Math.max(0, intensity));
    if (gasp) {
      this.noiseBurst(now, .46, 1140, .58, .018 + strength * .022, "bandpass", pan, .025);
      this.noiseBurst(now + .38, .78, 720, .72, .015 + strength * .023, "bandpass", pan * .5, .035);
      return;
    }
    this.noiseBurst(now, .42 + strength * .24, 680 + strength * 260, .66, .006 + strength * .014, "bandpass", pan, .022);
    if (strength > .62) {
      this.noiseBurst(now + .12, .3, 1850, .48, (strength - .62) * .012, "highpass", -pan * .4, .012);
    }
  }

  private athleteHeartbeat(now: number, stress: number) {
    const strength = Math.min(1, Math.max(0, stress));
    const gain = .008 + strength * .015;
    this.tone(now, 62, 44, .13, gain, "sine", -.05, .035);
    this.tone(now + .16, 54, 39, .11, gain * .66, "sine", .04, .028);
  }

  private setBreath(now: number, intensity: number, pan: number) {
    const strength = Math.min(1, Math.max(0, intensity));
    this.noiseBurst(now, .92, 340, .68, .035 + strength * .045, "bandpass", pan, .13);
    this.noiseBurst(now + .08, .68, 1750, .52, .018 + strength * .026, "highpass", pan * .84, .1);
    this.tone(now, 58, 41, .74, .018 + strength * .016, "sine", pan * .42, .16);
  }

  private gull(now: number) {
    const pan = Math.max(
      -.86,
      Math.min(.86, this.coastLandwardPan * 1.24 + (Math.random() - .5) * .42),
    );
    this.coastTone(now, 980 + Math.random() * 120, 1450 + Math.random() * 180, .34, .009, "sine", pan);
    this.coastTone(now + .29, 1320, 900, .29, .006, "sine", pan * .8);
  }
}
