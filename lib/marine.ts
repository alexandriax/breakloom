import type { Beach } from "./beaches";

export type TidePoint = { time: string; value: number };

export type MarineForecastPoint = {
  time: string;
  waveHeight: number;
  waveDirection: number;
  wavePeriod: number;
  windWaveHeight: number;
  windWaveDirection: number;
  windWavePeriod: number;
  windWavePeakPeriod: number;
  swellHeight: number;
  swellDirection: number;
  swellPeriod: number;
  swellPeakPeriod: number;
  secondarySwellHeight: number;
  secondarySwellDirection: number;
  secondarySwellPeriod: number;
  tertiarySwellHeight: number;
  tertiarySwellDirection: number;
  tertiarySwellPeriod: number;
  waterTemperature: number;
  currentVelocity: number;
  currentDirection: number;
  seaLevel: number;
  tideTrend: "rising" | "falling" | "slack";
  airTemperature: number;
  cloudCover: number;
  windSpeed: number;
  windDirection: number;
  weatherCode: number;
  isDay: boolean;
  sunrise: string;
  sunset: string;
};

export type MarineConditions = {
  source: "live" | "modeled";
  observedAt: string;
  timezone: string;
  timezoneAbbreviation: string;
  utcOffsetSeconds: number;
  waveHeight: number;
  waveDirection: number;
  wavePeriod: number;
  windWaveHeight: number;
  windWaveDirection: number;
  windWavePeriod: number;
  windWavePeakPeriod: number;
  swellHeight: number;
  swellDirection: number;
  swellPeriod: number;
  swellPeakPeriod: number;
  secondarySwellHeight: number;
  secondarySwellDirection: number;
  secondarySwellPeriod: number;
  tertiarySwellHeight: number;
  tertiarySwellDirection: number;
  tertiarySwellPeriod: number;
  waterTemperature: number;
  currentVelocity: number;
  currentDirection: number;
  seaLevel: number;
  tideTrend: "rising" | "falling" | "slack";
  tide: TidePoint[];
  airTemperature: number;
  cloudCover: number;
  windSpeed: number;
  windDirection: number;
  weatherCode: number;
  isDay: boolean;
  sunrise: string;
  sunset: string;
  forecast: MarineForecastPoint[];
};

type MarineResponse = {
  timezone?: string;
  timezone_abbreviation?: string;
  utc_offset_seconds?: number;
  current?: Record<string, number | string | null>;
  hourly?: {
    time?: string[];
    wave_height?: Array<number | null>;
    wave_direction?: Array<number | null>;
    wave_period?: Array<number | null>;
    wind_wave_height?: Array<number | null>;
    wind_wave_direction?: Array<number | null>;
    wind_wave_period?: Array<number | null>;
    wind_wave_peak_period?: Array<number | null>;
    swell_wave_height?: Array<number | null>;
    swell_wave_direction?: Array<number | null>;
    swell_wave_period?: Array<number | null>;
    swell_wave_peak_period?: Array<number | null>;
    secondary_swell_wave_height?: Array<number | null>;
    secondary_swell_wave_direction?: Array<number | null>;
    secondary_swell_wave_period?: Array<number | null>;
    tertiary_swell_wave_height?: Array<number | null>;
    tertiary_swell_wave_direction?: Array<number | null>;
    tertiary_swell_wave_period?: Array<number | null>;
    sea_surface_temperature?: Array<number | null>;
    ocean_current_velocity?: Array<number | null>;
    ocean_current_direction?: Array<number | null>;
    sea_level_height_msl?: Array<number | null>;
  };
};

type WeatherResponse = {
  utc_offset_seconds?: number;
  current?: Record<string, number | string | null>;
  hourly?: {
    time?: string[];
    temperature_2m?: Array<number | null>;
    cloud_cover?: Array<number | null>;
    wind_speed_10m?: Array<number | null>;
    wind_direction_10m?: Array<number | null>;
    weather_code?: Array<number | null>;
  };
  daily?: { time?: string[]; sunrise?: string[]; sunset?: string[] };
};

const numberOr = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

export type MarineSeaStateInput = {
  waveHeight: number;
  waveDirection?: number;
  wavePeriod?: number;
  windWaveHeight?: number;
  windWaveDirection?: number;
  windWavePeriod?: number;
  windWavePeakPeriod?: number;
  swellHeight?: number;
  swellDirection?: number;
  swellPeriod?: number;
  swellPeakPeriod?: number;
  secondarySwellHeight?: number;
  secondarySwellDirection?: number;
  secondarySwellPeriod?: number;
  tertiarySwellHeight?: number;
  tertiarySwellDirection?: number;
  tertiarySwellPeriod?: number;
};

export type MarineWavePartition = {
  height: number;
  direction: number;
  period: number;
  peakPeriod: number;
};

export type EnergyConsistentSeaState = {
  totalHeight: number;
  totalEnergy: number;
  partitionEnergy: number;
  residualEnergy: number;
  scaleApplied: number;
  partitions: {
    primarySwell: MarineWavePartition;
    secondarySwell: MarineWavePartition;
    tertiarySwell: MarineWavePartition;
    windWave: MarineWavePartition;
  };
};

const nonnegativeOr = (value: unknown, fallback = 0) =>
  Math.max(0, numberOr(value, fallback));

const positiveOr = (value: unknown, fallback: number) => {
  const candidate = numberOr(value, fallback);
  return candidate > 0 ? candidate : fallback;
};

const directionOr = (value: unknown, fallback: number) => {
  const direction = numberOr(value, fallback);
  return ((direction % 360) + 360) % 360;
};

/**
 * Converts Open-Meteo's independently reported wave components into one
 * significant-height energy budget. Component energy is proportional to Hs²:
 * over-budget inputs are uniformly scaled, while unassigned energy becomes
 * wind sea so callers never add a swell partition on top of total Hs.
 */
export function buildEnergyConsistentSeaState(
  input: MarineSeaStateInput,
): EnergyConsistentSeaState {
  const totalHeight = nonnegativeOr(input.waveHeight);
  const totalEnergy = totalHeight * totalHeight;
  const totalDirection = directionOr(input.waveDirection, 0);
  const totalPeriod = positiveOr(input.wavePeriod, 8);
  const swellDirection = directionOr(input.swellDirection, totalDirection);
  const swellPeriod = positiveOr(input.swellPeriod, totalPeriod);
  const windPeriodFallback = Math.max(3.5, Math.min(9, totalPeriod * .58));
  const windDirection = directionOr(input.windWaveDirection, totalDirection);
  const windPeriod = positiveOr(input.windWavePeriod, windPeriodFallback);

  const partitions = {
    primarySwell: {
      height: nonnegativeOr(input.swellHeight),
      direction: swellDirection,
      period: swellPeriod,
      peakPeriod: positiveOr(input.swellPeakPeriod, swellPeriod),
    },
    secondarySwell: {
      height: nonnegativeOr(input.secondarySwellHeight),
      direction: directionOr(input.secondarySwellDirection, swellDirection),
      period: positiveOr(input.secondarySwellPeriod, swellPeriod),
      peakPeriod: positiveOr(input.secondarySwellPeriod, swellPeriod),
    },
    tertiarySwell: {
      height: nonnegativeOr(input.tertiarySwellHeight),
      direction: directionOr(input.tertiarySwellDirection, swellDirection),
      period: positiveOr(input.tertiarySwellPeriod, swellPeriod),
      peakPeriod: positiveOr(input.tertiarySwellPeriod, swellPeriod),
    },
    windWave: {
      height: nonnegativeOr(input.windWaveHeight),
      direction: windDirection,
      period: windPeriod,
      peakPeriod: positiveOr(input.windWavePeakPeriod, windPeriod),
    },
  };
  const entries = Object.values(partitions);
  const suppliedEnergy = entries.reduce(
    (sum, partition) => sum + partition.height * partition.height,
    0,
  );
  const scaleApplied = suppliedEnergy > totalEnergy && suppliedEnergy > 0
    ? Math.sqrt(totalEnergy / suppliedEnergy)
    : 1;

  if (scaleApplied < 1) {
    entries.forEach((partition) => {
      partition.height *= scaleApplied;
    });
  } else {
    const residual = Math.max(0, totalEnergy - suppliedEnergy);
    partitions.windWave.height = Math.sqrt(
      partitions.windWave.height * partitions.windWave.height + residual,
    );
  }

  const partitionEnergy = entries.reduce(
    (sum, partition) => sum + partition.height * partition.height,
    0,
  );
  const residualEnergy = Math.max(0, totalEnergy - partitionEnergy);

  return {
    totalHeight,
    totalEnergy,
    partitionEnergy,
    residualEnergy,
    scaleApplied,
    partitions,
  };
}

type MarineWaveSnapshot = Pick<
  MarineConditions,
  | "waveHeight"
  | "waveDirection"
  | "wavePeriod"
  | "windWaveHeight"
  | "windWaveDirection"
  | "windWavePeriod"
  | "windWavePeakPeriod"
  | "swellHeight"
  | "swellDirection"
  | "swellPeriod"
  | "swellPeakPeriod"
  | "secondarySwellHeight"
  | "secondarySwellDirection"
  | "secondarySwellPeriod"
  | "tertiarySwellHeight"
  | "tertiarySwellDirection"
  | "tertiarySwellPeriod"
>;

function marineWaveSnapshot(
  input: MarineSeaStateInput,
  fallbackPrimarySwellRatio = .8,
): MarineWaveSnapshot {
  const totalHeight = nonnegativeOr(input.waveHeight);
  const suppliedSwellHeight = typeof input.swellHeight === "number"
    && Number.isFinite(input.swellHeight)
    ? input.swellHeight
    : undefined;
  const hasPartitionHeight = [
    input.windWaveHeight,
    suppliedSwellHeight,
    input.secondarySwellHeight,
    input.tertiarySwellHeight,
  ].some((height) => typeof height === "number" && Number.isFinite(height));
  const seaState = buildEnergyConsistentSeaState({
    ...input,
    swellHeight: suppliedSwellHeight ?? (
      hasPartitionHeight ? 0 : totalHeight * fallbackPrimarySwellRatio
    ),
  });
  const {
    primarySwell,
    secondarySwell,
    tertiarySwell,
    windWave,
  } = seaState.partitions;

  return {
    waveHeight: seaState.totalHeight,
    waveDirection: directionOr(input.waveDirection, 0),
    wavePeriod: positiveOr(input.wavePeriod, 8),
    windWaveHeight: windWave.height,
    windWaveDirection: windWave.direction,
    windWavePeriod: windWave.period,
    windWavePeakPeriod: windWave.peakPeriod,
    swellHeight: primarySwell.height,
    swellDirection: primarySwell.direction,
    swellPeriod: primarySwell.period,
    swellPeakPeriod: primarySwell.peakPeriod,
    secondarySwellHeight: secondarySwell.height,
    secondarySwellDirection: secondarySwell.direction,
    secondarySwellPeriod: secondarySwell.period,
    tertiarySwellHeight: tertiarySwell.height,
    tertiarySwellDirection: tertiarySwell.direction,
    tertiarySwellPeriod: tertiarySwell.period,
  };
}

function tideTrend(points: TidePoint[], observedAt: string) {
  if (points.length < 2) return "slack" as const;
  const target = new Date(observedAt).getTime();
  let nearest = 0;
  let distance = Infinity;
  points.forEach((point, index) => {
    const nextDistance = Math.abs(new Date(point.time).getTime() - target);
    if (nextDistance < distance) {
      nearest = index;
      distance = nextDistance;
    }
  });
  const before = points[Math.max(0, nearest - 1)]?.value ?? points[nearest].value;
  const after = points[Math.min(points.length - 1, nearest + 1)]?.value ?? points[nearest].value;
  if (after - before > 0.015) return "rising" as const;
  if (before - after > 0.015) return "falling" as const;
  return "slack" as const;
}

export async function fetchMarineConditions(
  beach: Beach,
  lat: number,
  lon: number,
  signal?: AbortSignal,
): Promise<MarineConditions> {
  const marineVariables = [
    "wave_height",
    "wave_direction",
    "wave_period",
    "wind_wave_height",
    "wind_wave_direction",
    "wind_wave_period",
    "wind_wave_peak_period",
    "swell_wave_height",
    "swell_wave_direction",
    "swell_wave_period",
    "swell_wave_peak_period",
    "secondary_swell_wave_height",
    "secondary_swell_wave_direction",
    "secondary_swell_wave_period",
    "tertiary_swell_wave_height",
    "tertiary_swell_wave_direction",
    "tertiary_swell_wave_period",
    "sea_surface_temperature",
    "ocean_current_velocity",
    "ocean_current_direction",
    "sea_level_height_msl",
  ];
  const marineParams = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: marineVariables.join(","),
    hourly: marineVariables.join(","),
    timezone: "auto",
    forecast_days: "2",
    cell_selection: "sea",
  });
  const weatherParams = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: "temperature_2m,cloud_cover,wind_speed_10m,wind_direction_10m,weather_code,is_day",
    hourly: "temperature_2m,cloud_cover,wind_speed_10m,wind_direction_10m,weather_code",
    daily: "sunrise,sunset",
    timezone: "auto",
    forecast_days: "2",
  });

  const [marineResponse, weatherResponse] = await Promise.all([
    fetch(`https://marine-api.open-meteo.com/v1/marine?${marineParams}`, { signal }),
    fetch(`https://api.open-meteo.com/v1/forecast?${weatherParams}`, { signal }),
  ]);

  if (!marineResponse.ok || !weatherResponse.ok) {
    throw new Error("Marine service unavailable");
  }

  const marine = (await marineResponse.json()) as MarineResponse;
  const weather = (await weatherResponse.json()) as WeatherResponse;
  const current = marine.current ?? {};
  const atmosphere = weather.current ?? {};
  const utcOffsetSeconds = numberOr(
    marine.utc_offset_seconds,
    numberOr(weather.utc_offset_seconds, 0),
  );
  const observedAt = String(current.time ?? atmosphere.time ?? new Date().toISOString());
  const tide: TidePoint[] = (marine.hourly?.time ?? [])
    .map((time, index) => ({
      time,
      value: numberOr(marine.hourly?.sea_level_height_msl?.[index], Number.NaN),
    }))
    .filter((point) => Number.isFinite(point.value));
  const weatherTimes = weather.hourly?.time ?? [];
  const weatherByTime = new Map(weatherTimes.map((time, index) => [time, index]));
  const dailyTimes = weather.daily?.time ?? [];
  const forecast: MarineForecastPoint[] = (marine.hourly?.time ?? []).map((time, index) => {
    const weatherIndex = weatherByTime.get(time) ?? Math.min(index, Math.max(0, weatherTimes.length - 1));
    const dayIndex = Math.max(0, dailyTimes.indexOf(time.slice(0, 10)));
    const sunrise = weather.daily?.sunrise?.[dayIndex] ?? `${time.slice(0, 10)}T06:00`;
    const sunset = weather.daily?.sunset?.[dayIndex] ?? `${time.slice(0, 10)}T19:30`;
    const wave = marineWaveSnapshot({
      waveHeight: numberOr(
        marine.hourly?.wave_height?.[index],
        numberOr(current.wave_height, beach.fallback.waveHeight),
      ),
      waveDirection: numberOr(
        marine.hourly?.wave_direction?.[index],
        numberOr(current.wave_direction, beach.fallback.waveDirection),
      ),
      wavePeriod: numberOr(
        marine.hourly?.wave_period?.[index],
        numberOr(current.wave_period, beach.fallback.wavePeriod),
      ),
      windWaveHeight: marine.hourly?.wind_wave_height?.[index]
        ?? numberOr(current.wind_wave_height, Number.NaN),
      windWaveDirection: marine.hourly?.wind_wave_direction?.[index]
        ?? numberOr(current.wind_wave_direction, Number.NaN),
      windWavePeriod: marine.hourly?.wind_wave_period?.[index]
        ?? numberOr(current.wind_wave_period, Number.NaN),
      windWavePeakPeriod: marine.hourly?.wind_wave_peak_period?.[index]
        ?? numberOr(current.wind_wave_peak_period, Number.NaN),
      swellHeight: marine.hourly?.swell_wave_height?.[index]
        ?? numberOr(current.swell_wave_height, Number.NaN),
      swellDirection: marine.hourly?.swell_wave_direction?.[index]
        ?? numberOr(current.swell_wave_direction, Number.NaN),
      swellPeriod: marine.hourly?.swell_wave_period?.[index]
        ?? numberOr(current.swell_wave_period, Number.NaN),
      swellPeakPeriod: marine.hourly?.swell_wave_peak_period?.[index]
        ?? numberOr(current.swell_wave_peak_period, Number.NaN),
      secondarySwellHeight: marine.hourly?.secondary_swell_wave_height?.[index]
        ?? numberOr(current.secondary_swell_wave_height, Number.NaN),
      secondarySwellDirection: marine.hourly?.secondary_swell_wave_direction?.[index]
        ?? numberOr(current.secondary_swell_wave_direction, Number.NaN),
      secondarySwellPeriod: marine.hourly?.secondary_swell_wave_period?.[index]
        ?? numberOr(current.secondary_swell_wave_period, Number.NaN),
      tertiarySwellHeight: marine.hourly?.tertiary_swell_wave_height?.[index]
        ?? numberOr(current.tertiary_swell_wave_height, Number.NaN),
      tertiarySwellDirection: marine.hourly?.tertiary_swell_wave_direction?.[index]
        ?? numberOr(current.tertiary_swell_wave_direction, Number.NaN),
      tertiarySwellPeriod: marine.hourly?.tertiary_swell_wave_period?.[index]
        ?? numberOr(current.tertiary_swell_wave_period, Number.NaN),
    });
    return {
      time,
      ...wave,
      waterTemperature: numberOr(marine.hourly?.sea_surface_temperature?.[index], numberOr(current.sea_surface_temperature, beach.fallback.waterTemperature)),
      currentVelocity: numberOr(marine.hourly?.ocean_current_velocity?.[index], numberOr(current.ocean_current_velocity, .4)),
      currentDirection: numberOr(marine.hourly?.ocean_current_direction?.[index], numberOr(current.ocean_current_direction, beach.heading)),
      seaLevel: numberOr(marine.hourly?.sea_level_height_msl?.[index], numberOr(current.sea_level_height_msl, 0)),
      tideTrend: tideTrend(tide, time),
      airTemperature: numberOr(weather.hourly?.temperature_2m?.[weatherIndex], numberOr(atmosphere.temperature_2m, beach.fallback.waterTemperature + 2)),
      cloudCover: numberOr(weather.hourly?.cloud_cover?.[weatherIndex], numberOr(atmosphere.cloud_cover, 25)),
      windSpeed: numberOr(weather.hourly?.wind_speed_10m?.[weatherIndex], numberOr(atmosphere.wind_speed_10m, beach.fallback.windSpeed)),
      windDirection: numberOr(weather.hourly?.wind_direction_10m?.[weatherIndex], numberOr(atmosphere.wind_direction_10m, beach.heading)),
      weatherCode: numberOr(weather.hourly?.weather_code?.[weatherIndex], numberOr(atmosphere.weather_code, 0)),
      isDay: time >= sunrise && time < sunset,
      sunrise,
      sunset,
    };
  });
  const wave = marineWaveSnapshot({
    waveHeight: numberOr(current.wave_height, beach.fallback.waveHeight),
    waveDirection: numberOr(current.wave_direction, beach.fallback.waveDirection),
    wavePeriod: numberOr(current.wave_period, beach.fallback.wavePeriod),
    windWaveHeight: numberOr(current.wind_wave_height, Number.NaN),
    windWaveDirection: numberOr(current.wind_wave_direction, Number.NaN),
    windWavePeriod: numberOr(current.wind_wave_period, Number.NaN),
    windWavePeakPeriod: numberOr(current.wind_wave_peak_period, Number.NaN),
    swellHeight: numberOr(current.swell_wave_height, Number.NaN),
    swellDirection: numberOr(current.swell_wave_direction, Number.NaN),
    swellPeriod: numberOr(current.swell_wave_period, Number.NaN),
    swellPeakPeriod: numberOr(current.swell_wave_peak_period, Number.NaN),
    secondarySwellHeight: numberOr(current.secondary_swell_wave_height, Number.NaN),
    secondarySwellDirection: numberOr(current.secondary_swell_wave_direction, Number.NaN),
    secondarySwellPeriod: numberOr(current.secondary_swell_wave_period, Number.NaN),
    tertiarySwellHeight: numberOr(current.tertiary_swell_wave_height, Number.NaN),
    tertiarySwellDirection: numberOr(current.tertiary_swell_wave_direction, Number.NaN),
    tertiarySwellPeriod: numberOr(current.tertiary_swell_wave_period, Number.NaN),
  });

  return {
    source: "live",
    observedAt,
    timezone: marine.timezone ?? "Local time",
    timezoneAbbreviation: marine.timezone_abbreviation ?? "",
    utcOffsetSeconds,
    ...wave,
    waterTemperature: numberOr(current.sea_surface_temperature, beach.fallback.waterTemperature),
    currentVelocity: numberOr(current.ocean_current_velocity, 0.4),
    currentDirection: numberOr(current.ocean_current_direction, beach.heading),
    seaLevel: numberOr(current.sea_level_height_msl, 0),
    tideTrend: tideTrend(tide, observedAt),
    tide,
    airTemperature: numberOr(atmosphere.temperature_2m, beach.fallback.waterTemperature + 2),
    cloudCover: numberOr(atmosphere.cloud_cover, 25),
    windSpeed: numberOr(atmosphere.wind_speed_10m, beach.fallback.windSpeed),
    windDirection: numberOr(atmosphere.wind_direction_10m, beach.heading),
    weatherCode: numberOr(atmosphere.weather_code, 0),
    isDay: numberOr(atmosphere.is_day, 1) === 1,
    sunrise: weather.daily?.sunrise?.[0] ?? "06:00",
    sunset: weather.daily?.sunset?.[0] ?? "19:30",
    forecast,
  };
}

export function fallbackConditions(beach: Beach, referenceTime?: string | Date): MarineConditions {
  const now = referenceTime ? new Date(referenceTime) : new Date();
  const utcOffsetSeconds = Math.max(-12, Math.min(14, Math.round(beach.lon / 15))) * 3600;
  const localIso = (date: Date) => new Date(date.getTime() + utcOffsetSeconds * 1000)
    .toISOString()
    .slice(0, 19);
  const observedAt = localIso(now);
  const tide = Array.from({ length: 57 }, (_, index) => ({
    time: localIso(new Date(now.getTime() + (index - 8) * 3_600_000)),
    value: Math.sin((index / 12.4) * Math.PI * 2) * 0.72,
  }));
  const forecast: MarineForecastPoint[] = Array.from({ length: 49 }, (_, index) => {
    const time = localIso(new Date(now.getTime() + index * 3_600_000));
    const localHour = Number(time.slice(11, 13));
    const seaLevel = Math.sin(((index + 8) / 12.4) * Math.PI * 2) * .72;
    const wave = marineWaveSnapshot({
      waveHeight: Math.max(.25, beach.fallback.waveHeight * (1 + Math.sin(index * .31) * .08)),
      waveDirection: beach.fallback.waveDirection,
      wavePeriod: Math.max(5, beach.fallback.wavePeriod + Math.sin(index * .17) * .6),
      swellHeight: beach.fallback.waveHeight * .8,
      swellDirection: beach.fallback.waveDirection,
      swellPeriod: beach.fallback.wavePeriod,
      swellPeakPeriod: beach.fallback.wavePeriod,
    });
    return {
      time,
      ...wave,
      waterTemperature: beach.fallback.waterTemperature,
      currentVelocity: .4 + Math.sin(index * .24) * .08,
      currentDirection: beach.heading,
      seaLevel,
      tideTrend: tideTrend(tide, time),
      airTemperature: beach.fallback.waterTemperature + 2 + Math.sin(((localHour - 7) / 24) * Math.PI * 2) * 3,
      cloudCover: 18,
      windSpeed: beach.fallback.windSpeed * (1 + Math.sin(index * .21) * .12),
      windDirection: beach.heading,
      weatherCode: 0,
      isDay: localHour >= 6 && localHour < 19,
      sunrise: `${time.slice(0, 10)}T06:00`,
      sunset: `${time.slice(0, 10)}T19:30`,
    };
  });
  const wave = marineWaveSnapshot({
    waveHeight: beach.fallback.waveHeight,
    waveDirection: beach.fallback.waveDirection,
    wavePeriod: beach.fallback.wavePeriod,
    swellHeight: beach.fallback.waveHeight * .8,
    swellDirection: beach.fallback.waveDirection,
    swellPeriod: beach.fallback.wavePeriod,
    swellPeakPeriod: beach.fallback.wavePeriod,
  });
  return {
    source: "modeled",
    observedAt,
    timezone: "Modeled local time",
    timezoneAbbreviation: `UTC${utcOffsetSeconds >= 0 ? "+" : ""}${utcOffsetSeconds / 3600}`,
    utcOffsetSeconds,
    ...wave,
    waterTemperature: beach.fallback.waterTemperature,
    currentVelocity: 0.4,
    currentDirection: beach.heading,
    seaLevel: 0,
    tideTrend: "rising",
    tide,
    airTemperature: beach.fallback.waterTemperature + 2,
    cloudCover: 18,
    windSpeed: beach.fallback.windSpeed,
    windDirection: beach.heading,
    weatherCode: 0,
    isDay: true,
    sunrise: "06:00",
    sunset: "19:30",
    forecast,
  };
}
