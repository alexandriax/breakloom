/**
 * Checks that every coast reference in lib/beaches.ts is on land, while every
 * surf zone is a place you could actually paddle out: in the sea, and within
 * a swim of land.
 *
 * Land and water are read from the same OpenStreetMap tiles the game renders,
 * where water is a flat #AAD3DF, so the check agrees with what a player sees on
 * the map. A coast accidentally placed at sea gets a landward suggestion, and
 * any zone stranded in open ocean gets one pulled back toward its shoreline.
 *
 * It also cross-checks each coast's `heading` against the coastline two ways,
 * and warns when a recorded bearing disagrees with both - the failure mode that
 * put several coasts at the wrong angle to the swell.
 *
 * Run manually after editing coastlines - it fetches tiles, so it is kept out
 * of `npm test`:
 *
 *   npm run verify:zones
 *
 * Tiles are cached in .tiles/ so repeat runs do not re-fetch.
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";

const CACHE = resolve(process.argv[2] ?? ".tiles");
if (!existsSync(CACHE)) mkdirSync(CACHE, { recursive: true });
const ZOOM = 16;
const TILE = 256;
const WATER = [170, 211, 223];

const source = readFileSync("lib/beaches.ts", "utf8");
const beaches = [];
for (const block of source.split(/\n  \{\n    id: /).slice(1)) {
  const id = block.match(/^"([^"]+)"/)?.[1];
  const name = block.match(/name: "([^"]+)"/)?.[1];
  const latitude = Number(block.match(/\n    lat: (-?[\d.]+)/)?.[1]);
  const longitude = Number(block.match(/\n    lon: (-?[\d.]+)/)?.[1]);
  const heading = Number(block.match(/heading: (-?[\d.]+)/)?.[1]);
  // A bearing whose comment says the fits mislead is a deliberate override.
  const overridden = /heading:.*fits confused/.test(block);
  const zones = [...block.matchAll(/\{ name: "([^"]+)", lat: (-?[\d.]+), lon: (-?[\d.]+), note: "([^"]*)" \}/g)]
    .map((m) => ({ name: m[1], lat: Number(m[2]), lon: Number(m[3]) }));
  if (id && zones.length) beaches.push({
    id,
    name,
    latitude,
    longitude,
    heading,
    overridden,
    zones,
  });
}

const project = (lat, lon) => {
  const n = 2 ** ZOOM;
  return {
    x: ((lon + 180) / 360) * n,
    y: ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n,
  };
};
const tiles = new Map();
async function tile(tx, ty) {
  const key = `${tx}-${ty}`;
  if (tiles.has(key)) return tiles.get(key);
  const file = resolve(CACHE, `${ZOOM}-${tx}-${ty}.png`);
  if (!existsSync(file)) {
    const response = await fetch(`https://tile.openstreetmap.org/${ZOOM}/${tx}/${ty}.png`, {
      headers: { "User-Agent": "breakloom-zone-audit/1.0 (coordinate QA; contact via repo)" },
    });
    if (!response.ok) throw new Error(`tile ${ZOOM}/${tx}/${ty}: ${response.status}`);
    writeFileSync(file, Buffer.from(await response.arrayBuffer()));
    await new Promise((r) => setTimeout(r, 110));
  }
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const decoded = { data, channels: info.channels };
  tiles.set(key, decoded);
  return decoded;
}
async function isWater(lat, lon) {
  const { x, y } = project(lat, lon);
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  const { data, channels } = await tile(tx, ty);
  const px = Math.min(TILE - 2, Math.max(1, Math.floor((x - tx) * TILE)));
  const py = Math.min(TILE - 2, Math.max(1, Math.floor((y - ty) * TILE)));
  let wet = 0;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const i = ((py + dy) * TILE + (px + dx)) * channels;
      if (
        Math.abs(data[i] - WATER[0]) < 12
        && Math.abs(data[i + 1] - WATER[1]) < 12
        && Math.abs(data[i + 2] - WATER[2]) < 12
      ) wet += 1;
    }
  }
  return wet >= 5;
}
const metresPerPixel = (lat) => (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** ZOOM;

/** Nearest land in any direction: the honest test of "is this a paddle-out". */
async function nearestLand(lat, lon) {
  const step = metresPerPixel(lat);
  for (let radius = 2; radius <= 320; radius += 2) {
    for (let angle = 0; angle < 360; angle += 8) {
      const offset = radius * step;
      const point = {
        lat: lat + (offset * Math.cos((angle * Math.PI) / 180)) / 111320,
        lon: lon + (offset * Math.sin((angle * Math.PI) / 180)) / (111320 * Math.cos((lat * Math.PI) / 180)),
      };
      if (!(await isWater(point.lat, point.lon))) return Math.round(offset);
    }
  }
  return null;
}

/** Widest search, used only to rescue a zone stranded in open ocean. */
async function landDirection(lat, lon) {
  const step = metresPerPixel(lat);
  for (let radius = 4; radius <= 1400; radius += 4) {
    for (let angle = 0; angle < 360; angle += 6) {
      const offset = radius * step;
      const point = {
        lat: lat + (offset * Math.cos((angle * Math.PI) / 180)) / 111320,
        lon: lon + (offset * Math.sin((angle * Math.PI) / 180)) / (111320 * Math.cos((lat * Math.PI) / 180)),
      };
      if (!(await isWater(point.lat, point.lon))) return { angle, distance: offset };
    }
  }
  return null;
}

const coastRepairs = [];
const zoneRepairs = [];
let failures = 0;
for (const beach of beaches) {
  console.log(`\n${beach.name}`);
  const centerWet = await isWater(beach.latitude, beach.longitude);
  console.log(`  ${centerWet ? "FAIL" : "ok  "}  Coast reference    ${centerWet ? "water" : "LAND "}`);
  if (centerWet) {
    failures += 1;
    const found = await landDirection(beach.latitude, beach.longitude);
    if (found) {
      const inland = found.distance + 30;
      const shoreLatitude = beach.latitude
        + (inland * Math.cos((found.angle * Math.PI) / 180)) / 111320;
      const shoreLongitude = beach.longitude
        + (inland * Math.sin((found.angle * Math.PI) / 180))
          / (111320 * Math.cos((beach.latitude * Math.PI) / 180));
      coastRepairs.push({
        beach: beach.id,
        lat: Number(shoreLatitude.toFixed(5)),
        lon: Number(shoreLongitude.toFixed(5)),
      });
    }
  }
  for (const zone of beach.zones) {
    const wet = await isWater(zone.lat, zone.lon);
    const land = wet ? await nearestLand(zone.lat, zone.lon) : 0;
    const ok = wet && land !== null && land <= 700;
    if (!ok) {
      failures += 1;
      const found = wet ? await landDirection(zone.lat, zone.lon) : null;
      if (found) {
        const pull = found.distance - 140;
        zoneRepairs.push({
          beach: beach.id,
          zone: zone.name,
          lat: Number((zone.lat + (pull * Math.cos((found.angle * Math.PI) / 180)) / 111320).toFixed(4)),
          lon: Number((zone.lon + (pull * Math.sin((found.angle * Math.PI) / 180)) / (111320 * Math.cos((zone.lat * Math.PI) / 180))).toFixed(4)),
        });
      }
    }
    console.log(
      `  ${ok ? "ok  " : "FAIL"}  ${zone.name.padEnd(18)} ${wet ? "water" : "LAND "}`
      + `  ${land === null ? "open ocean, no land within 800 m" : `${land} m from the nearest land`}`,
    );
  }
}
const bearingOf = (north, east) => ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;
const angleGap = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
const move = (lat, lon, bearing, metres) => {
  const radians = (bearing * Math.PI) / 180;
  return {
    lat: lat + (metres * Math.cos(radians)) / 111320,
    lon: lon + (metres * Math.sin(radians)) / (111320 * Math.cos((lat * Math.PI) / 180)),
  };
};

console.log("\nCoast bearings, against the rendered coastline:");
let bearingWarnings = 0;
for (const beach of beaches) {
  let north = 0;
  let east = 0;
  const shore = [];
  for (const zone of beach.zones) {
    const step = metresPerPixel(zone.lat);
    let land = null;
    for (let radius = 2; radius <= 320 && !land; radius += 2) {
      for (let angle = 0; angle < 360; angle += 4) {
        const point = move(zone.lat, zone.lon, angle, radius * step);
        if (!(await isWater(point.lat, point.lon))) { land = { angle, ...point }; break; }
      }
    }
    if (!land) continue;
    const seaward = (land.angle + 180) % 360;
    north += Math.cos((seaward * Math.PI) / 180);
    east += Math.sin((seaward * Math.PI) / 180);
    shore.push(land);
  }
  if (shore.length < 2) continue;
  const fromZones = bearingOf(north, east);

  const meanLat = shore.reduce((t, p) => t + p.lat, 0) / shore.length;
  const meanLon = shore.reduce((t, p) => t + p.lon, 0) / shore.length;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const point of shore) {
    const dx = (point.lon - meanLon) * 111320 * Math.cos((meanLat * Math.PI) / 180);
    const dy = (point.lat - meanLat) * 111320;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  const along = bearingOf(Math.sin(.5 * Math.atan2(2 * sxy, sxx - syy)), Math.cos(.5 * Math.atan2(2 * sxy, sxx - syy)));
  let fromCoast = along + 90;
  let best = -1;
  for (const option of [(along + 90) % 360, (along + 270) % 360]) {
    let wet = 0;
    for (const distance of [80, 160, 320, 640]) {
      const probe = move(meanLat, meanLon, option, distance);
      if (await isWater(probe.lat, probe.lon)) wet += 1;
    }
    if (wet > best) { best = wet; fromCoast = option; }
  }

  // Both fits mislead where a headland, breakwater or reef sits seaward of the
  // peak, so only disagreeing with both is worth a warning.
  const gap = Math.min(angleGap(beach.heading, fromZones), angleGap(beach.heading, fromCoast));
  const suspect = gap > 60 && !beach.overridden;
  if (suspect) bearingWarnings += 1;
  console.log(
    `  ${suspect ? "WARN" : beach.overridden && gap > 60 ? "set " : "ok  "}  ${beach.name.padEnd(18)} recorded ${String(beach.heading).padStart(3)}°`
    + `  zones ${String(Math.round(fromZones)).padStart(3)}°  coastline ${String(Math.round(fromCoast)).padStart(3)}°`,
  );
}
console.log(
  bearingWarnings
    ? `${bearingWarnings} coast bearing(s) disagree with both fits by more than 60° without explanation.`
    : "  (\"set\" marks a bearing deliberately set against the fits; see the comment in lib/beaches.ts.)",
);

console.log(
  failures === 0
    ? "\nEvery coast reference is on land, and every surf peak is in the sea within a swim of shore."
    : `\n${failures} coast reference or surf zone check(s) failed.`,
);
if (coastRepairs.length) {
  console.log("\nSuggested coast references, moved onto land:");
  for (const repair of coastRepairs) console.log(`  ${repair.beach}: ${repair.lat}, ${repair.lon}`);
}
if (zoneRepairs.length) {
  console.log("\nSuggested surf peaks, pulled shoreward from open water:");
  for (const repair of zoneRepairs) console.log(`  ${repair.beach}/${repair.zone}: ${repair.lat}, ${repair.lon}`);
}
process.exit(failures === 0 ? 0 : 1);
