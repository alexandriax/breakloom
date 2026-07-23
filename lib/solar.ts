export type SolarPosition = {
  azimuth: number;
  elevation: number;
  sinElevation: number;
  equationOfTime: number;
};

type SolarPositionInput = {
  latitude: number;
  longitude: number;
  localDateTime: string;
  localHour: number;
  utcOffsetSeconds: number;
};

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

function isLeapYear(year: number) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function wrap(value: number, range: number) {
  return ((value % range) + range) % range;
}

function atmosphericRefraction(elevation: number) {
  if (elevation > 85) return 0;
  const tangent = Math.tan(elevation * DEG_TO_RAD);
  if (elevation > 5) {
    return (58.1 / tangent - .07 / tangent ** 3 + .000086 / tangent ** 5) / 3600;
  }
  if (elevation > -.575) {
    return (
      1735
      + elevation * (
        -518.2
        + elevation * (
          103.4
          + elevation * (-12.79 + elevation * .711)
        )
      )
    ) / 3600;
  }
  return (-20.772 / tangent) / 3600;
}

export function solarPositionAt({
  latitude,
  longitude,
  localDateTime,
  localHour,
  utcOffsetSeconds,
}: SolarPositionInput): SolarPosition | null {
  const match = localDateTime.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return null;

  const yearStart = Date.UTC(year, 0, 0);
  const dayOfYear = Math.floor((date.getTime() - yearStart) / 86_400_000);
  const daysInYear = isLeapYear(year) ? 366 : 365;
  const hour = wrap(localHour, 24);
  const fractionalYear = (Math.PI * 2 / daysInYear)
    * (dayOfYear - 1 + (hour - 12) / 24);
  const equationOfTime = 229.18 * (
    .000075
    + .001868 * Math.cos(fractionalYear)
    - .032077 * Math.sin(fractionalYear)
    - .014615 * Math.cos(2 * fractionalYear)
    - .040849 * Math.sin(2 * fractionalYear)
  );
  const declination = .006918
    - .399912 * Math.cos(fractionalYear)
    + .070257 * Math.sin(fractionalYear)
    - .006758 * Math.cos(2 * fractionalYear)
    + .000907 * Math.sin(2 * fractionalYear)
    - .002697 * Math.cos(3 * fractionalYear)
    + .00148 * Math.sin(3 * fractionalYear);
  const timeOffset = equationOfTime + 4 * longitude - utcOffsetSeconds / 60;
  const trueSolarMinutes = wrap(hour * 60 + timeOffset, 1440);
  let hourAngle = trueSolarMinutes / 4 - 180;
  if (hourAngle < -180) hourAngle += 360;

  const latitudeRadians = Math.max(-89.999, Math.min(89.999, latitude)) * DEG_TO_RAD;
  const hourAngleRadians = hourAngle * DEG_TO_RAD;
  const sinElevation = Math.max(-1, Math.min(
    1,
    Math.sin(latitudeRadians) * Math.sin(declination)
      + Math.cos(latitudeRadians) * Math.cos(declination) * Math.cos(hourAngleRadians),
  ));
  const geometricElevation = Math.asin(sinElevation) * RAD_TO_DEG;
  const elevation = geometricElevation + atmosphericRefraction(geometricElevation);
  const azimuthRadians = Math.atan2(
    Math.sin(hourAngleRadians),
    Math.cos(hourAngleRadians) * Math.sin(latitudeRadians)
      - Math.tan(declination) * Math.cos(latitudeRadians),
  ) + Math.PI;

  return {
    azimuth: wrap(azimuthRadians * RAD_TO_DEG, 360),
    elevation,
    sinElevation: Math.sin(elevation * DEG_TO_RAD),
    equationOfTime,
  };
}
