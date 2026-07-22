import type { Beach } from "./beaches";

export type TidePoint = { time: string; value: number };

export type MarineConditions = {
  source: "live" | "modeled";
  observedAt: string;
  timezone: string;
  timezoneAbbreviation: string;
  waveHeight: number;
  waveDirection: number;
  wavePeriod: number;
  swellHeight: number;
  swellDirection: number;
  swellPeriod: number;
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
};

type MarineResponse = {
  timezone?: string;
  timezone_abbreviation?: string;
  current?: Record<string, number | string | null>;
  hourly?: { time?: string[]; sea_level_height_msl?: Array<number | null> };
};

type WeatherResponse = {
  current?: Record<string, number | string | null>;
  daily?: { sunrise?: string[]; sunset?: string[] };
};

const numberOr = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

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
  const marineParams = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: [
      "wave_height",
      "wave_direction",
      "wave_period",
      "swell_wave_height",
      "swell_wave_direction",
      "swell_wave_period",
      "sea_surface_temperature",
      "ocean_current_velocity",
      "ocean_current_direction",
      "sea_level_height_msl",
    ].join(","),
    hourly: "sea_level_height_msl",
    timezone: "auto",
    forecast_days: "2",
    cell_selection: "sea",
  });
  const weatherParams = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: "temperature_2m,cloud_cover,wind_speed_10m,wind_direction_10m,weather_code,is_day",
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
  const observedAt = String(current.time ?? atmosphere.time ?? new Date().toISOString());
  const tide: TidePoint[] = (marine.hourly?.time ?? [])
    .map((time, index) => ({
      time,
      value: numberOr(marine.hourly?.sea_level_height_msl?.[index], Number.NaN),
    }))
    .filter((point) => Number.isFinite(point.value));

  return {
    source: "live",
    observedAt,
    timezone: marine.timezone ?? "Local time",
    timezoneAbbreviation: marine.timezone_abbreviation ?? "",
    waveHeight: numberOr(current.wave_height, beach.fallback.waveHeight),
    waveDirection: numberOr(current.wave_direction, beach.fallback.waveDirection),
    wavePeriod: numberOr(current.wave_period, beach.fallback.wavePeriod),
    swellHeight: numberOr(current.swell_wave_height, beach.fallback.waveHeight * 0.8),
    swellDirection: numberOr(current.swell_wave_direction, beach.fallback.waveDirection),
    swellPeriod: numberOr(current.swell_wave_period, beach.fallback.wavePeriod),
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
  };
}

export function fallbackConditions(beach: Beach, referenceTime?: string | Date): MarineConditions {
  const now = referenceTime ? new Date(referenceTime) : new Date();
  const tide = Array.from({ length: 24 }, (_, index) => ({
    time: new Date(now.getTime() + (index - 8) * 3_600_000).toISOString(),
    value: Math.sin((index / 12) * Math.PI * 2) * 0.72,
  }));
  return {
    source: "modeled",
    observedAt: now.toISOString(),
    timezone: "Local time",
    timezoneAbbreviation: "",
    waveHeight: beach.fallback.waveHeight,
    waveDirection: beach.fallback.waveDirection,
    wavePeriod: beach.fallback.wavePeriod,
    swellHeight: beach.fallback.waveHeight * 0.8,
    swellDirection: beach.fallback.waveDirection,
    swellPeriod: beach.fallback.wavePeriod,
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
  };
}
