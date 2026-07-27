/**
 * Checks that every surf zone in lib/beaches.ts is a place you could actually
 * paddle out: in the sea, and within a swim of land.
 *
 * Land and water are read from the same OpenStreetMap tiles the game renders,
 * where water is a flat #AAD3DF, so the check agrees with what a player sees on
 * the map. Any zone stranded in open ocean gets a suggested position pulled
 * back toward its nearest shoreline.
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
  const heading = Number(block.match(/heading: (-?[\d.]+)/)?.[1]);
  const zones = [...block.matchAll(/\{ name: "([^"]+)", lat: (-?[\d.]+), lon: (-?[\d.]+), note: "([^"]*)" \}/g)]
    .map((m) => ({ name: m[1], lat: Number(m[2]), lon: Number(m[3]) }));
  if (id && zones.length) beaches.push({ id, name, heading, zones });
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
      headers: { "User-Agent": "surfscape-zone-audit/1.0 (coordinate QA; contact via repo)" },
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

const repairs = [];
let failures = 0;
for (const beach of beaches) {
  console.log(`\n${beach.name}`);
  for (const zone of beach.zones) {
    const wet = await isWater(zone.lat, zone.lon);
    const land = wet ? await nearestLand(zone.lat, zone.lon) : 0;
    const ok = wet && land !== null && land <= 700;
    if (!ok) {
      failures += 1;
      const found = wet ? await landDirection(zone.lat, zone.lon) : null;
      if (found) {
        const pull = found.distance - 140;
        repairs.push({
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
console.log(failures === 0 ? "\nEvery paddle-out sits in the sea within a swim of land." : `\n${failures} zone(s) failed.`);
if (repairs.length) {
  console.log("\nSuggested positions, pulled shoreward from open water:");
  for (const repair of repairs) console.log(`  ${repair.beach}/${repair.zone}: ${repair.lat}, ${repair.lon}`);
}
process.exit(failures === 0 ? 0 : 1);
